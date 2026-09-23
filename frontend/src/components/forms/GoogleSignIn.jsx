import { useState } from "react";
import { Chrome } from "lucide-react";
import { firebaseConfigured } from "../../firebase/firebase";
import useFirebaseAuth from "../../hooks/useFirebaseAuth";

export default function GoogleSignIn({ onSuccess, onError, remember = true }) {
  const [loading, setLoading] = useState(false);
  const { googleSignIn } = useFirebaseAuth();
  const open = async () => {
    if (!firebaseConfigured) return onError("Firebase Authentication is not configured. Add the VITE_FIREBASE_* values and restart Vite.");
    setLoading(true);
    try { onSuccess(await googleSignIn(remember)); }
    catch (error) { onError(error.response?.data?.message || error.message || "Google sign-in failed."); }
    finally { setLoading(false); }
  };
  return <button type="button" onClick={open} disabled={loading} className="auth-secondary w-full disabled:cursor-not-allowed disabled:opacity-50"><Chrome size={18} />{loading ? "Connecting to Google..." : "Continue with Google"}</button>;
}
