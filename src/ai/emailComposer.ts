import { OpenAI } from "openai";

export type TemplateType = "introduction" | "followup" | "status_update" | "escalation";

export type Tone = "formal" | "neutral" | "polite" | "assertive";

export interface ComposeEmailInput {
  recipient: string;
  purpose: string;
  tone: Tone;
  template: TemplateType;
}

export interface EmailContent {
  subject: string;
  greeting: string;
  body: string;
  cta: string;
  signature: string;
}


export const composeEmail = async (params: ComposeEmailInput): Promise<EmailContent> => {
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
