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
  // when the user changes the template dropdown we re-open the view with or without the data field
  app.action("template_select", async (args) => {
    const { ack, body, action, client } = args as any;
    console.log("template_select action fired", action);
    await ack();
    const selected = (action as any).selected_option?.value;
    console.log("template_select selected", selected);
    // view is nested inside body for block actions
    const view = (body as any).view;
    if (!view) {
      console.warn("template_select handler invoked without view");
      return;
    }
    // gather existing values so we can preserve them
    const state = view.state.values;
    const existing: any = {
      recipient: state.recipient_block?.recipient_input.value,
      purpose: state.purpose_block?.purpose_input.value,
      tone: state.tone_block?.tone_select.selected_option?.value,
      template: selected as string,
      data: state.data_block?.data_input.value,
    };

    try {
      await client.views.update({
        view_id: view.id,
        hash: view.hash,
        view: buildComposeEmailModal(existing),
      });
    } catch (err) {
      console.error("failed to update modal on template change", err);
    }
  });

  app.view("compose_email_modal", async ({ ack, body, view, client }) => {
    const state = view.state.values;

    const recipient = state.recipient_block.recipient_input.value?.trim();
    const purpose = state.purpose_block.purpose_input.value?.trim();
    const toneValue = state.tone_block.tone_select.selected_option?.value;
    const templateValue = state.template_block.template_select.selected_option?.value;
    const dataDump = state.data_block?.data_input.value?.trim();

    if (!recipient || !purpose || !toneValue || !templateValue) {
      await ack({ response_action: "errors", errors: { recipient_block: "All fields are required" } });
      return;
    }

    const tone = TONE_VALUES[toneValue];
    const template = templateValue as TemplateType;

    if (template === "bi_delivery" && !dataDump) {
      await ack({
        response_action: "errors",
        errors: { data_block: "Please provide the data to include in the BI delivery." },
      });
      return;
    }

    await ack();

    try {
      const aiContent = await composeEmail({ recipient, purpose, tone, template, data: dataDump });
      const html = await renderTemplate(template, aiContent);

      const draftId = await saveDraft({
        slackUserId: body.user.id,
        recipient,
        template,
        content: { subject: aiContent.subject, body: aiContent.body },
        html,
      });

      const dumpToMarkdown = (dump: string): string => {
        const rows = dump
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .map((r) => r.split(/[\t,]/).map((c) => c.trim()));
        if (rows.length === 0) return "";
        const header = rows[0].join(" | ");
        const separator = rows[0].map(() => "---").join(" | ");
        const bodyRows = rows.slice(1).map((r) => r.join(" | ")).join("\n");
        return `\n${header}\n${separator}${bodyRows ? "\n" + bodyRows : ""}`;
      };

      let preview = aiContent.body.length > 180 ? `${aiContent.body.slice(0, 180)}...` : aiContent.body;
      if (template === "bi_delivery" && dataDump) {
        preview += dumpToMarkdown(dataDump);
      }
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
              value: JSON.stringify({ recipient, purpose, tone, template, data: dataDump }),
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
        data: metadata.data,
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
    case "bi_delivery":
      return "BI Delivery";
  }
};
