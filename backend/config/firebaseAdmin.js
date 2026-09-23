const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

let firebaseAuth = null;

const getFirebaseAuth = () => {
  if (firebaseAuth) return firebaseAuth;
  if (getApps().length) {
    firebaseAuth = getAuth();
    return firebaseAuth;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!serviceAccountJson && !(projectId && clientEmail && privateKey)) return null;

  const credential = serviceAccountJson
    ? cert(JSON.parse(serviceAccountJson))
    : cert({ projectId, clientEmail, privateKey });
  firebaseAuth = getAuth(initializeApp({ credential }));
  return firebaseAuth;
};

module.exports = { getFirebaseAuth };

