import { useState } from "react";
import { exchangeFirebaseSession } from "../services/authBridge";
import { firebaseErrorMessage, firebaseGoogleLogin, firebaseLogin, firebaseLogout, firebaseRegister, firebasePasswordReset } from "../services/firebaseAuth";

export default function useFirebaseAuth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const run = async (operation) => {
    setLoading(true); setError("");
    try { return await operation(); } catch (requestError) { setError(firebaseErrorMessage(requestError)); throw requestError; } finally { setLoading(false); }
  };
  return {
    loading,
    error,
    login: (email, password, remember) => run(() => firebaseLogin(email, password, remember)),
    register: (details) => run(() => firebaseRegister(details)),
    googleSignIn: (remember) => run(async () => exchangeFirebaseSession(await firebaseGoogleLogin(remember))),
    forgotPassword: (email) => run(() => firebasePasswordReset(email)),
    logout: () => run(() => firebaseLogout()),
  };
}

