import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

const initializeSMTP = () => {
  if (transporter) return;

  const smtpHost = process.env.SMTP_HOST || "localhost";
  const smtpPort = parseInt(process.env.SMTP_PORT || "2525");
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const senderEmail = process.env.SENDER_EMAIL;
  const useMock = process.env.MOCK_SEND === "true";

  console.log(`[SMTP Init] Host: ${smtpHost}, Port: ${smtpPort}, User: ${smtpUser ? 'SET' : 'MISSING'}, Sender: ${senderEmail || 'MISSING'}, Mock: ${useMock}`);

  if (!useMock) {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // true for 465, false for other ports
      auth: smtpUser && smtpPass ? {
        user: smtpUser,
        pass: smtpPass,
      } : undefined,
    });
  } else {
    console.warn("SMTP not configured — sendEmail will run in mock mode");
  }
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export const sendEmail = async (params: SendEmailParams): Promise<string> => {
  initializeSMTP();

  const senderEmail = process.env.SENDER_EMAIL || "notifications@example.com";
  const useMock = process.env.MOCK_SEND === "true" || !transporter;

  if (useMock) {
    // do not log secret content — only a minimal trace for local dev
    console.log(`[mock sendEmail] to=${params.to} subject=${params.subject}`);
    return `mock-${Date.now()}`;
  }

  try {
    console.log(`[SMTP] Sending from ${senderEmail} to ${params.to}`);
    const info = await transporter!.sendMail({
      from: senderEmail,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    console.log(`[SMTP] Email sent successfully, message ID: ${info.messageId}`);
    return info.messageId;
  } catch (error: any) {
    console.error("[SMTP Error]", error);
    throw new Error(`SMTP failed: ${error.message}`);
  }
};
