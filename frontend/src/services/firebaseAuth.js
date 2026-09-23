import {
  browserLocalPersistence,
  browserSessionPersistence,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  updateProfile,
  verifyPasswordResetCode,
} from "firebase/auth";
import { firebaseAuth, firebaseConfigured } from "../firebase/firebase";

const requireFirebase = () => {
  if (!firebaseConfigured || !firebaseAuth) {
    const error = new Error("Firebase Authentication is not configured.");
    error.code = "firebase/not-configured";
    throw error;
  }
  return firebaseAuth;
};

export const firebaseErrorMessage = (error) => {
  const messages = {
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/user-not-found": "The email or password is incorrect.",
    "auth/wrong-password": "The email or password is incorrect.",
    "auth/email-already-in-use": "An account already exists with this email.",
    "auth/weak-password": "Use a stronger password with at least 8 characters.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/popup-blocked": "Your browser blocked the Google sign-in popup.",
    "auth/network-request-failed": "Network error. Check your connection and try again.",
    "firebase/not-configured": "Firebase Authentication is not configured yet.",
  };
  return messages[error?.code] || error?.message || "Authentication failed. Please try again.";
};

export const setRememberedAuth = (remember) => setPersistence(requireFirebase(), remember ? browserLocalPersistence : browserSessionPersistence);

export const firebaseLogin = async (email, password, remember = true) => {
  const auth = requireFirebase();
  await setRememberedAuth(remember);
  const result = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  if (!result.user.emailVerified) {
    await signOut(auth);
    const error = new Error("Please verify your email before signing in.");
    error.code = "auth/email-not-verified";
    throw error;
  }
  return result.user;
};

export const firebaseRegister = async ({ name, email, password, remember = true }) => {
  const auth = requireFirebase();
  await setRememberedAuth(remember);
  const result = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  await updateProfile(result.user, { displayName: name.trim() });
  await sendEmailVerification(result.user);
  return result.user;
};

export const firebaseGoogleLogin = async (remember = true) => {
  const auth = requireFirebase();
  await setRememberedAuth(remember);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  return result.user;
};

export const firebasePasswordReset = (email) => sendPasswordResetEmail(requireFirebase(), email.trim().toLowerCase(), { url: `${window.location.origin}/reset-password`, handleCodeInApp: true });
export const firebaseVerifyResetCode = (code) => verifyPasswordResetCode(requireFirebase(), code);
export const firebaseConfirmReset = (code, password) => confirmPasswordReset(requireFirebase(), code, password);
export const firebaseLogout = () => firebaseAuth ? signOut(firebaseAuth) : Promise.resolve();
export const firebaseIdToken = (user) => user.getIdToken(true);

