interface ComposeModalValues {
  recipient?: string;
  purpose?: string;
  tone?: "formal" | "neutral" | "polite" | "assertive";
  template?: "introduction" | "followup" | "status_update" | "escalation";
}

export const buildComposeEmailModal = (initialValues?: ComposeModalValues): any => ({
  type: "modal",
  callback_id: "compose_email_modal",
  title: {
    type: "plain_text",
    text: "Compose Email",
    emoji: true,
  },
  submit: {
    type: "plain_text",
    text: "Generate",
    emoji: true,
  },
  close: {
    type: "plain_text",
    text: "Cancel",
    emoji: true,
  },
  blocks: [
    {
      type: "input",
      block_id: "recipient_block",
      label: {
        type: "plain_text",
        text: "Recipient email",
      },
      element: {
        type: "plain_text_input",
        action_id: "recipient_input",
        placeholder: {
          type: "plain_text",
          text: "me@example.com",
        },
        initial_value: initialValues?.recipient ?? "",
      },
    },
    {
      type: "input",
      block_id: "purpose_block",
      label: {
        type: "plain_text",
        text: "Purpose",
      },
      element: {
        type: "plain_text_input",
        action_id: "purpose_input",
        multiline: true,
        initial_value: initialValues?.purpose ?? "",
      },
    },
    {
      type: "input",
      block_id: "tone_block",
      label: {
        type: "plain_text",
        text: "Tone",
      },
      element: {
        type: "static_select",
        action_id: "tone_select",
        placeholder: {
          type: "plain_text",
          text: "Select tone",
        },
        initial_option: initialValues?.tone
          ? {
            text: {
              type: "plain_text",
              text: capitalize(initialValues.tone),
            },
            value: initialValues.tone,
          }
          : undefined,
        options: [
          createOption("Formal", "formal"),
          createOption("Neutral", "neutral"),
          createOption("Polite", "polite"),
          createOption("Assertive", "assertive"),
        ],
      },
    },
    {
      type: "input",
      block_id: "template_block",
      label: {
        type: "plain_text",
        text: "Template",
      },
      element: {
        type: "static_select",
        action_id: "template_select",
        placeholder: {
          type: "plain_text",
          text: "Pick a template",
        },
        initial_option: initialValues?.template
          ? {
            text: {
              type: "plain_text",
              text: formatTemplateLabel(initialValues.template),
            },
            value: initialValues.template,
          }
          : undefined,
        options: [
          createOption("Introduction", "introduction"),
          createOption("Follow-up", "followup"),
          createOption("Status update", "status_update"),
          createOption("Escalation", "escalation"),
        ],
      },
    },
  ],
});

const createOption = (label: string, value: string) => ({
  text: {
    type: "plain_text",
    text: label,
  },
  value,
});

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const formatTemplateLabel = (value: string) => {
  switch (value) {
    case "introduction":
      return "Introduction";
    case "followup":
      return "Follow-up";
    case "status_update":
      return "Status update";
    case "escalation":
    default:
      return "Escalation";
  }
};
