// Load environment variables immediately before any other module imports
require('dotenv').config();

const { LogLevel } = require('@slack/bolt');
const { registerActions } = require('./slack/actions');
const { registerCommands } = require('./slack/commands');

// Require only Slack credentials for local development — other services have fallbacks
const requiredEnv = ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable ${key}`);
  }
}

if (!process.env.OPENAI_API_KEY) {
  console.warn('OPENAI_API_KEY not set — using mock AI responses (set MOCK_OPENAI=true to force)');
}
if (!process.env.SENDGRID_API_KEY) {
  console.warn('SENDGRID_API_KEY not set — emails will be mocked (set MOCK_SEND=true to force)');
}

const express = require('express');
const { composeEmail } = require('./ai/emailComposer');
const { renderTemplate } = require('./email/templateRenderer');
const { saveDraft, getDraftById, markDraftAsSent, logEmail } = require('./services/draftService');
const { sendEmail } = require('./email/sender');

// If SLACK_APP_TOKEN (xapp-) is present, use Socket Mode (no public HTTP required).
if (process.env.SLACK_APP_TOKEN) {
  const { App, SocketModeReceiver } = require('@slack/bolt');

  const socketReceiver = new SocketModeReceiver({ appToken: process.env.SLACK_APP_TOKEN });

  const boltApp = new App({
    token: process.env.SLACK_BOT_TOKEN,
    receiver: socketReceiver,
    logLevel: LogLevel.INFO,
    processBeforeResponse: true,
  });

  registerCommands(boltApp);
  registerActions(boltApp);

  // Start the socket connection
  (async () => {
    try {
      await boltApp.start();
      console.log('✅ Slack app (Socket Mode) connected successfully');
    } catch (err) {
      console.error('❌ Socket Mode connection failed:', err);
      console.error('Check: (1) SLACK_APP_TOKEN is valid, (2) Socket Mode is enabled in Slack app, (3) Network allows WebSocket connections');
    }
  })();

  // expose small express app for local internal endpoints /health
  const app = express();
  app.use(express.json());
  app.get('/', (_req, res) => res.send('Slack-email bot (socket mode) is running'));

  app.post('/internal/generate', async (req, res) => {
    const { recipient, purpose, tone, template } = req.body ?? {};
    if (!recipient || !purpose || !tone || !template) {
      return res.status(400).json({ error: 'recipient, purpose, tone and template are required' });
    }

    try {
      const aiContent = await composeEmail({ recipient, purpose, tone, template });
      const html = await renderTemplate(template, aiContent);
      const draftId = await saveDraft({
        slackUserId: 'local-test',
        recipient,
        template,
        content: { subject: aiContent.subject, body: aiContent.body },
        html,
      });

      return res.json({ draftId, subject: aiContent.subject, preview: aiContent.body.slice(0, 180) });
    } catch (err) {
      console.error('internal generate failed', err);
      return res.status(500).json({ error: String(err) });
    }
  });

  app.post('/internal/send/:id', async (req, res) => {
    const draftId = req.params.id;
    const draft = await getDraftById(draftId);
    if (!draft) return res.status(404).json({ error: 'draft not found' });

    try {
      const messageId = await sendEmail({ to: draft.recipient, subject: draft.content.subject, html: draft.html });
      await markDraftAsSent(draftId);
      await logEmail({ draftId, recipient: draft.recipient, status: 'sent', providerMessageId: messageId });
      return res.json({ ok: true, messageId });
    } catch (err) {
      console.error('internal send failed', err);
      return res.status(500).json({ error: String(err) });
    }
  });

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => console.log(`HTTP test endpoints listening on ${port}`));
} else {
  // Fallback: run with ExpressReceiver (requires public URL / ngrok)
  const { App, ExpressReceiver } = require('@slack/bolt');

  const receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    endpoints: { commands: '/slack/commands', actions: '/slack/actions', events: '/slack/events' },
    processBeforeResponse: true,
  });

  // add simple JSON body parsing and internal debug endpoints for local testing
  receiver.app.use(express.json());

  receiver.app.post('/internal/generate', async (req, res) => {
    const { recipient, purpose, tone, template } = req.body ?? {};
    if (!recipient || !purpose || !tone || !template) {
      return res.status(400).json({ error: 'recipient, purpose, tone and template are required' });
    }

    try {
      const aiContent = await composeEmail({ recipient, purpose, tone, template });
      const html = await renderTemplate(template, aiContent);
      const draftId = await saveDraft({
        slackUserId: 'local-test',
        recipient,
        template,
        content: { subject: aiContent.subject, body: aiContent.body },
        html,
      });

      return res.json({ draftId, subject: aiContent.subject, preview: aiContent.body.slice(0, 180) });
    } catch (err) {
      console.error('internal generate failed', err);
      return res.status(500).json({ error: String(err) });
    }
  });

  receiver.app.post('/internal/send/:id', async (req, res) => {
    const draftId = req.params.id;
    const draft = await getDraftById(draftId);
    if (!draft) return res.status(404).json({ error: 'draft not found' });

    try {
      const messageId = await sendEmail({ to: draft.recipient, subject: draft.content.subject, html: draft.html });
      await markDraftAsSent(draftId);
      await logEmail({ draftId, recipient: draft.recipient, status: 'sent', providerMessageId: messageId });
      return res.json({ ok: true, messageId });
    } catch (err) {
      console.error('internal send failed', err);
      return res.status(500).json({ error: String(err) });
    }
  });

  const boltApp = new App({
    token: process.env.SLACK_BOT_TOKEN,
    receiver,
    logLevel: LogLevel.INFO,
    processBeforeResponse: true,
  });

  registerCommands(boltApp);
  registerActions(boltApp);

  receiver.app.get('/', (_req, res) => {
    res.send('Slack-email bot is running');
  });

  const port = Number(process.env.PORT ?? 3000);
  receiver.app.listen(port, () => {
    console.log(`Server listening on ${port}`);
  });
}
