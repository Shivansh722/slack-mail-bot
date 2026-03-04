import { TemplateType } from "../ai/emailComposer";

// In-memory fallback for local development when Firestore isn't configured
const inMemoryDrafts = new Map<string, any>();
let inMemoryAutoId = 1;

const tryGetFirestore = async () => {
  try {
    // dynamic import to avoid throwing at module load when credentials are missing
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = await import("../db/firestore");
    return { firestore: mod.firestore, FieldValue: mod.FieldValue };
  } catch (err) {
    return null;
  }
};

export interface DraftContent {
  subject: string;
  body: string;
}

export interface SaveDraftParams {
  slackUserId: string;
  recipient: string;
  template: TemplateType;
  content: DraftContent;
  html: string;
}

export interface DraftRecord {
  id: string;
  slackUserId: string;
  recipient: string;
  template: TemplateType;
  content: DraftContent;
  html: string;
  status: "draft" | "sent";
  createdAt: FirebaseFirestore.Timestamp;
}

export const saveDraft = async (params: SaveDraftParams): Promise<string> => {
  const fb = await tryGetFirestore();
  if (!fb) {
    const id = `local-${inMemoryAutoId++}`;
    inMemoryDrafts.set(id, {
      id,
      slackUserId: params.slackUserId,
      recipient: params.recipient,
      template: params.template,
      content: params.content,
      html: params.html,
      status: "draft",
      createdAt: new Date(),
    });
    return id;
  }

  try {
    const draftRef = await fb.firestore.collection("drafts").add({
      slackUserId: params.slackUserId,
      recipient: params.recipient,
      template: params.template,
      content: params.content,
      html: params.html,
      status: "draft",
      createdAt: fb.FieldValue.serverTimestamp(),
    });

    return draftRef.id;
  } catch (err) {
    console.warn('Firestore write failed, falling back to in-memory store:', (err as any)?.message ?? err);
    const id = `local-${inMemoryAutoId++}`;
    inMemoryDrafts.set(id, {
      id,
      slackUserId: params.slackUserId,
      recipient: params.recipient,
      template: params.template,
      content: params.content,
      html: params.html,
      status: "draft",
      createdAt: new Date(),
    });
    return id;
  }
};

export const getDraftById = async (draftId: string): Promise<DraftRecord | null> => {
  const fb = await tryGetFirestore();
  if (!fb) {
    const found = inMemoryDrafts.get(draftId) ?? null;
    if (!found) return null;
    return {
      id: found.id,
      slackUserId: found.slackUserId,
      recipient: found.recipient,
      template: found.template,
      content: found.content,
      html: found.html,
      status: found.status,
      createdAt: found.createdAt,
    } as DraftRecord;
  }

  try {
    const doc = await fb.firestore.collection("drafts").doc(draftId).get();
    if (!doc.exists) {
      return null;
    }

    const data = doc.data();
    return {
      id: doc.id,
      slackUserId: data?.slackUserId,
      recipient: data?.recipient,
      template: data?.template,
      content: data?.content,
      html: data?.html,
      status: data?.status,
      createdAt: data?.createdAt,
    } as DraftRecord;
  } catch (err) {
    console.warn('Firestore read failed, falling back to in-memory store:', (err as any)?.message ?? err);
    const found = inMemoryDrafts.get(draftId) ?? null;
    if (!found) return null;
    return {
      id: found.id,
      slackUserId: found.slackUserId,
      recipient: found.recipient,
      template: found.template,
      content: found.content,
      html: found.html,
      status: found.status,
      createdAt: found.createdAt,
    } as DraftRecord;
  }
};

export const markDraftAsSent = async (draftId: string): Promise<void> => {
  const fb = await tryGetFirestore();
  if (!fb) {
    const doc = inMemoryDrafts.get(draftId);
    if (doc) {
      doc.status = "sent";
      doc.sentAt = new Date();
      inMemoryDrafts.set(draftId, doc);
    }
    return;
  }

  try {
    await fb.firestore.collection("drafts").doc(draftId).update({
      status: "sent",
      sentAt: fb.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn('Firestore update failed, marking in-memory draft as sent:', (err as any)?.message ?? err);
    const doc = inMemoryDrafts.get(draftId);
    if (doc) {
      doc.status = "sent";
      doc.sentAt = new Date();
      inMemoryDrafts.set(draftId, doc);
    }
  }
};

export interface EmailLogParams {
  draftId: string;
  recipient: string;
  status: "sent" | "failed";
  providerMessageId: string;
}

export const logEmail = async (params: EmailLogParams): Promise<void> => {
  const fb = await tryGetFirestore();
  if (!fb) {
    // store a lightweight log with a predictable id in memory
    const id = `log-${Date.now()}`;
    inMemoryDrafts.set(id, {
      id,
      draftId: params.draftId,
      recipient: params.recipient,
      status: params.status,
      providerMessageId: params.providerMessageId,
      sentAt: new Date(),
    });
    return;
  }

  try {
    await fb.firestore.collection("email_logs").add({
      draftId: params.draftId,
      recipient: params.recipient,
      status: params.status,
      providerMessageId: params.providerMessageId,
      sentAt: fb.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn('Firestore insert for email_logs failed, saving log in-memory:', (err as any)?.message ?? err);
    const id = `log-${Date.now()}`;
    inMemoryDrafts.set(id, {
      id,
      draftId: params.draftId,
      recipient: params.recipient,
      status: params.status,
      providerMessageId: params.providerMessageId,
      sentAt: new Date(),
    });
  }
};
