import sgMail from "@sendgrid/mail";

let initialized = false;

const initializeSendGrid = () => {
  if (initialized) return;
  
  const apiKey = process.env.SENDGRID_API_KEY;
  const senderEmail = process.env.SENDER_EMAIL;
  const useMock = !apiKey || process.env.MOCK_SEND === "true";

  console.log(`[SendGrid Init] API Key: ${apiKey ? 'SET' : 'MISSING'}, Sender: ${senderEmail || 'MISSING'}, Mock: ${useMock}`);

  if (!useMock && apiKey) {
    sgMail.setApiKey(apiKey);
  } else if (!apiKey) {
    console.warn("SendGrid API key missing — sendEmail will run in mock mode");
  }
  
  initialized = true;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export const sendEmail = async (params: SendEmailParams): Promise<string> => {
  initializeSendGrid();
  
  const senderEmail = process.env.SENDER_EMAIL || "notifications@example.com";
  const useMock = !process.env.SENDGRID_API_KEY || process.env.MOCK_SEND === "true";
  
  if (useMock) {
    // do not log secret content — only a minimal trace for local dev
    console.log(`[mock sendEmail] to=${params.to} subject=${params.subject}`);
    return `mock-${Date.now()}`;
  }

  try {
    console.log(`[SendGrid] Sending from ${senderEmail} to ${params.to}`);
    const [response] = await sgMail.send({
      to: params.to,
      from: senderEmail,
      subject: params.subject,
      html: params.html,
    });

    const messageId = response.headers?.["x-message-id"] ?? response.headers?.["x-smtp-id"] ?? "";
    console.log(`[SendGrid] Email sent successfully, message ID: ${messageId}`);
    return messageId;
  } catch (error: any) {
    console.error("[SendGrid Error]", error.response?.body || error.message);
    throw new Error(`SendGrid failed: ${error.response?.body?.errors?.[0]?.message || error.message}`);
  }
};
