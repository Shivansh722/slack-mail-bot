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
      // ask AI to generate a concise summary of the dataset
      const systemPrompt = `You are a professional email assistant. Reply with valid JSON only using the structure {"subject":"","greeting":"","body":"","cta":"","signature":""}. Do not include markdown or tables.
Always keep the subject at most eight words and use professional language.`;
      const userPrompt = `Dataset: ${params.data ?? ""}
Purpose: ${params.purpose}
Tone: ${params.tone}`;

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
          // override body but keep signature/cta
          body = parsed.body || body;
        } catch {
          // ignore parse failures
        }
      }
    }

    const content: EmailContent = {
      subject,
      greeting,
      body,
      cta: "",
      signature: "Best regards,\nYour Team",
      dataTable: params.data ? dumpToTable(params.data) : undefined,
    };
    return content;
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
