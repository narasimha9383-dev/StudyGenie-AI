import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import AuthLayout from "../layouts/AuthLayout";
import api from "../api/axios";
import { firebaseConfigured } from "../firebase/firebase";
import { firebaseConfirmReset, firebaseErrorMessage, firebaseVerifyResetCode } from "../services/firebaseAuth";

export default function ResetPassword() {
  const { token = "" } = useParams();
  const location = useLocation();
  const queryCode = new URLSearchParams(location.search).get("oobCode") || "";
  const resetCode = queryCode || token;
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(Boolean(queryCode));
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    if (!queryCode || !firebaseConfigured) return;
    firebaseVerifyResetCode(queryCode).then(() => setLoading(false)).catch((requestError) => { setError(firebaseErrorMessage(requestError)); setLoading(false); });
  }, [queryCode]);

  const submit = async (event) => {
    event.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters for your new password.");
    if (password !== confirm) return setError("Passwords do not match.");
    if (!resetCode) return setError("This reset link is missing or invalid.");
    setError(""); setLoading(true);
    try {
      if (queryCode && firebaseConfigured) await firebaseConfirmReset(queryCode, password);
      else await api.post("/auth/reset-password", { token: resetCode, password });
      setUpdated(true);
    } catch (requestError) {
      setError(requestError.response?.data?.message || firebaseErrorMessage(requestError));
    } finally { setLoading(false); }
  };

  return <AuthLayout><motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="auth-card p-6 sm:p-8">{updated ? <div className="py-10 text-center"><span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#39ff14]/15 text-[#65ff45]"><CheckCircle2 size={32} /></span><h1 className="mt-6 font-[Space_Grotesk] text-3xl font-bold">Password updated</h1><p className="mt-3 text-sm leading-6 text-zinc-400">Your account is secured with the new password.</p><button onClick={() => navigate("/login")} className="auth-primary mt-7 w-full">Back to sign in</button></div> : <><div className="grid h-12 w-12 place-items-center rounded-2xl border border-[#39ff14]/25 bg-[#39ff14]/10 text-[#65ff45]"><LockKeyhole size={22} /></div><h1 className="mt-5 font-[Space_Grotesk] text-3xl font-bold">Create a new password</h1><p className="mt-3 text-sm leading-6 text-zinc-400">Choose a strong password with at least eight characters.</p>{error && <p role="alert" className="mt-5 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}<form onSubmit={submit} className="mt-7 space-y-4"><div className="auth-field"><LockKeyhole className="pointer-events-none absolute left-4 top-[18px] z-10 text-zinc-500" size={18} /><input id="new-password" type={show ? "text" : "password"} placeholder=" " value={password} onChange={(event) => setPassword(event.target.value)} minLength="8" required disabled={loading} /><label htmlFor="new-password">New password</label><button type="button" onClick={() => setShow(!show)} className="absolute right-4 top-[17px] text-zinc-500 hover:text-[#65ff45]" aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div><div className="auth-field"><LockKeyhole className="pointer-events-none absolute left-4 top-[18px] z-10 text-zinc-500" size={18} /><input id="confirm-password" type={show ? "text" : "password"} placeholder=" " value={confirm} onChange={(event) => setConfirm(event.target.value)} required disabled={loading} /><label htmlFor="confirm-password">Confirm new password</label></div><button disabled={loading} className="auth-primary w-full disabled:bg-zinc-700 disabled:text-zinc-400">{loading ? "Validating reset link…" : "Update password"}</button></form><p className="mt-6 text-center text-sm text-zinc-500">Remembered it? <Link to="/login" className="text-[#65ff45] hover:underline">Sign in</Link></p></>}</motion.div></AuthLayout>;
}
