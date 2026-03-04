import { App, BlockAction } from "@slack/bolt";
import { composeEmail, TemplateType, Tone } from "../ai/emailComposer";
import { renderTemplate } from "../email/templateRenderer";
import { saveDraft, logEmail, getDraftById, markDraftAsSent } from "../services/draftService";
import { buildComposeEmailModal } from "./modals";
import { sendEmail } from "../email/sender";

const TONE_VALUES: Record<string, Tone> = {
  formal: "formal",
  neutral: "neutral",
  polite: "polite",
  assertive: "assertive",
};

export const registerActions = (app: App): void => {
  app.view("compose_email_modal", async ({ ack, body, view, client }) => {
    await ack();

    const state = view.state.values;

    const recipient = state.recipient_block.recipient_input.value?.trim();
    const purpose = state.purpose_block.purpose_input.value?.trim();
    const toneValue = state.tone_block.tone_select.selected_option?.value;
    const templateValue = state.template_block.template_select.selected_option?.value;

    if (!recipient || !purpose || !toneValue || !templateValue) {
      return;
    }

    const tone = TONE_VALUES[toneValue];
    const template = templateValue as TemplateType;

    try {
      const aiContent = await composeEmail({ recipient, purpose, tone, template });
      const html = await renderTemplate(template, aiContent);

      const draftId = await saveDraft({
        slackUserId: body.user.id,
        recipient,
        template,
        content: { subject: aiContent.subject, body: aiContent.body },
        html,
      });

      const preview = aiContent.body.length > 180 ? `${aiContent.body.slice(0, 180)}...` : aiContent.body;
      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Subject:* ${aiContent.subject}\n*Preview:* ${preview}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Template: ${formatTemplateLabel(template)}`,
            },
          ],
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              action_id: "rewrite_email",
              text: {
                type: "plain_text",
                text: "🔄 Rewrite",
              },
              style: "primary",
              value: JSON.stringify({ recipient, purpose, tone, template }),
            },
            {
              type: "button",
              action_id: "send_email",
              text: {
                type: "plain_text",
                text: "📤 Send",
              },
              style: "primary",
              value: draftId,
            },
          ],
        },
      ];

      await client.chat.postMessage({
        channel: body.user.id,
        text: `Email preview for ${recipient}`,
        blocks,
      });
    } catch (error) {
      console.error("Failed to generate email draft", error);
      await client.chat.postMessage({
        channel: body.user.id,
        text: "Unable to generate email draft. Please try again.",
      });
    }
  });

  app.action("rewrite_email", async ({ ack, action, body, client }) => {
    await ack();

    const metadata = JSON.parse((action as any).value);

    await client.views.open({
      trigger_id: (body as any).trigger_id as string,
      view: buildComposeEmailModal({
        recipient: metadata.recipient,
        purpose: metadata.purpose,
        tone: metadata.tone,
        template: metadata.template,
      }),
    });
  });

  app.action("send_email", async ({ ack, action, body, client }) => {
    await ack();

    const draftId = (action as any).value;

    const draft = await getDraftById(draftId);
    if (!draft) {
      await client.chat.postEphemeral({
        channel: body.channel?.id as string,
        user: body.user.id,
        text: "Unable to find the draft. Please retry.",
      });
      return;
    }

    try {
      const messageId = await sendEmail({
        to: draft.recipient,
        subject: draft.content.subject,
        html: draft.html,
      });

      await markDraftAsSent(draftId);
      await logEmail({
        draftId,
        recipient: draft.recipient,
        status: "sent",
        providerMessageId: messageId,
      });

      if (body.channel?.id && "message" in body && body.message?.ts) {
        await client.chat.update({
          channel: body.channel.id,
          ts: body.message.ts,
          text: "Email sent",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `✅ Sent to ${draft.recipient}`,
              },
            },
          ],
        });
      }

      await client.chat.postEphemeral({
        channel: body.channel?.id as string,
        user: body.user.id,
        text: `Email sent to ${draft.recipient}`,
      });
    } catch (error) {
      await client.chat.postEphemeral({
        channel: body.channel?.id as string,
        user: body.user.id,
        text: `Failed to send email: ${error}`,
      });
    }
  });
};

const formatTemplateLabel = (value: TemplateType): string => {
  switch (value) {
    case "introduction":
      return "Introduction";
    case "followup":
      return "Follow-up";
    case "status_update":
      return "Status Update";
    case "escalation":
      return "Escalation";
  }
};
