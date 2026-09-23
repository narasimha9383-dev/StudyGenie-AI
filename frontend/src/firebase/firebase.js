import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

// Treat template values as unconfigured. This keeps the existing JWT login
// working until real Firebase credentials are supplied.
const isConfiguredValue = (value) => Boolean(value) && !/^your[-_]/i.test(value) && !/^your[-_a-z]*firebase/i.test(value);
export const firebaseConfigured = [config.apiKey, config.authDomain, config.projectId, config.appId].every(isConfiguredValue);
export const firebaseApp = firebaseConfigured ? (getApps().length ? getApp() : initializeApp(config)) : null;
export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;
