import admin from "firebase-admin";
import fs from "node:fs";

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

if (!serviceAccountJson && !serviceAccountPath) {
  throw new Error("Firebase service account credentials are required");
}

let credentialConfig: admin.ServiceAccount;

if (serviceAccountPath) {
  const buffer = fs.readFileSync(serviceAccountPath, "utf-8");
  credentialConfig = JSON.parse(buffer);
} else {
  credentialConfig = JSON.parse(serviceAccountJson as string);
}

const firebaseApp = admin.apps.length
  ? admin.app()
  : admin.initializeApp({
      credential: admin.credential.cert(credentialConfig),
    });

export const firestore = firebaseApp.firestore();
export const FieldValue = admin.firestore.FieldValue;
