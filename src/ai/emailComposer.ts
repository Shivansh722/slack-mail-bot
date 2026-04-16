import { OpenAI } from "openai";

export type TemplateType = "introduction" | "followup" | "status_update" | "escalation" | "bi_delivery"; // BI Delivery template

export type Tone = "formal" | "neutral" | "polite" | "assertive";

export interface ComposeEmailInput {
  recipient: string;
  purpose: string;
  tone: Tone;
  template: TemplateType;
  // for BI delivery mails we accept a raw dump of tabular data
  data?: string;
}

export interface EmailContent {
  subject: string;
  greeting: string;
  body: string;
  cta: string;
  signature: string;
  // if present, the BI template will render this HTML string inside a mj-table
  dataTable?: string;
  // new AI-driven fields for BI template (optional)
  preheader?: string;
  subheading?: string;
  ai_summary?: string;
  ai_highlight?: string;
  ai_key_insight?: string;
  // HTML or markdown-safe list of actions (preferred as HTML <ul><li>)
  ai_actions?: string;
}


export const composeEmail = async (params: ComposeEmailInput): Promise<EmailContent> => {
  // helper to convert raw dump text into table row HTML
  const dumpToTable = (dump: string): string => {
    const lines = dump
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return lines
      .map((line) => {
        const cells = line.split(/[\t,]/).map((c) => `<td>${c.trim()}</td>`);
        return `<tr>${cells.join("")}</tr>`;
      })
      .join("");
  };

  // BI template – include data and optionally ask AI to summarize it
  if (params.template === "bi_delivery") {
    const subject = "BI Data Delivery";
    const greeting = `Hi ${params.recipient.split("@")[0]},`;
    let body = params.purpose.trim() || "Please find the attached data.";

    if (process.env.OPENAI_API_KEY && process.env.MOCK_OPENAI !== "true") {
    // ask AI to generate structured content matching MJML placeholders
    const systemPrompt = `You are a professional email assistant. Reply with valid JSON only using the exact structure:
  {"subject":"","preheader":"","subheading":"","greeting":"","ai_summary":"","ai_highlight":"","ai_key_insight":"","ai_actions":"","body":"","cta":"","signature":""}
  Do not include any extra keys, commentary, or markdown. Keep values plain text or HTML-safe (for lists use <ul><li>items</li></ul>). Keep the subject at most eight words and use professional language.`;

    const userPrompt = `Dataset: ${params.data ?? ""}
  Purpose: ${params.purpose}
  Tone: ${params.tone}
  Instructions:
  - Provide a short ` + "`preheader`" + ` (1 line preview) and a concise ` + "`subheading`" + ` for the email header.
  - Produce ` + "`ai_summary`" + `: a 1-3 sentence executive summary of the dataset.
  - Produce ` + "`ai_highlight`" + `: a one-sentence highlight or callout.
  - Produce ` + "`ai_key_insight`" + `: a short, focused insight for the callout box.
  - Produce ` + "`ai_actions`" + `: 3 short action items as an HTML unordered list (<ul><li>...)</li></ul>.
  Use the dataset to surface notable changes, anomalies, or recommended next steps.`;

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      const raw = response.choices?.[0]?.message?.content?.trim();
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as EmailContent;
          // merge parsed fields where present
          body = parsed.body || body;
          // attach other optional fields onto the content object later
          // we'll return them in the final EmailContent
          // store parsed in a temporary variable
          const aiParsed = parsed;
          const content: EmailContent = {
            subject: parsed.subject || subject,
            greeting,
            body,
            cta: parsed.cta || "",
            signature: parsed.signature || "Best regards,\nYour Team",
            dataTable: params.data ? dumpToTable(params.data) : undefined,
            preheader: aiParsed.preheader,
            subheading: aiParsed.subheading,
            ai_summary: aiParsed.ai_summary,
            ai_highlight: aiParsed.ai_highlight,
            ai_key_insight: aiParsed.ai_key_insight,
            ai_actions: aiParsed.ai_actions,
          };
          return content;
        } catch {
          // ignore parse failures
        }
      }
    }
    // If AI is disabled or parsing failed above, return a deterministic fallback content
    const fallback: EmailContent = {
      subject,
      greeting,
      body,
      cta: "",
      signature: "Best regards,\nYour Team",
      dataTable: params.data ? dumpToTable(params.data) : undefined,
      preheader: "Automated BI delivery",
      subheading: "Latest metrics and recommended actions",
      ai_summary: "Summary: Key metrics are within expected ranges. See table for details.",
      ai_highlight: "Revenue up 4% vs prior period.",
      ai_key_insight: "Revenue increased driven by higher conversion in paid channels.",
      ai_actions: "<ul><li>Investigate paid channel spend</li><li>Share insights with marketing</li><li>Review conversion funnel</li></ul>",
    };
    return fallback;
  }

  // If OPENAI_API_KEY is missing or MOCK_OPENAI is set, return a deterministic mock
  if (!process.env.OPENAI_API_KEY || process.env.MOCK_OPENAI === "true") {
    const subject = `${params.template} update`;
    return {
      subject: subject.split(" ").slice(0, 8).join(" "),
      greeting: `Hi ${params.recipient.split("@")[0]},`,
      body: `Regarding your request: ${params.purpose.trim()}`,
      cta: `Please let me know if you'd like to proceed.`,
      signature: `Best regards,\nYour Team`,
    };
  }

  const systemPrompt = `You are a professional email assistant.
 Reply with valid JSON only and do not add markdown, emojis, or commentary.
 Use professional, concise language and keep the subject at most eight words.
 Always return the structure {"subject":"", "greeting":"", "body":"", "cta":"", "signature":""}.`;
  const userPrompt = `Purpose: ${params.purpose}
Tone: ${params.tone}
Template: ${params.template}
Recipient: ${params.recipient}`;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 500,
  });

  const raw = response.choices?.[0]?.message?.content?.trim();
  if (!raw) {
    throw new Error("AI did not return any content");
  }

  try {
    const parsed = JSON.parse(raw) as EmailContent;
    return parsed;
  } catch (error) {
    throw new Error("Unable to parse AI response as JSON");
  }
};
