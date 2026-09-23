import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, KeyRound, Mail, Send } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../layouts/AuthLayout";
import api from "../api/axios";
import { firebaseConfigured } from "../firebase/firebase";
import { firebaseErrorMessage, firebasePasswordReset } from "../services/firebaseAuth";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [developmentToken, setDevelopmentToken] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (firebaseConfigured) {
        await firebasePasswordReset(email);
      } else {
        const { data } = await api.post("/auth/forgot-password", { email });
        setDevelopmentToken(data.developmentToken || "");
      }
      setSent(true);
    } catch (requestError) {
      if (firebaseConfigured && requestError?.code === "auth/user-not-found") { setSent(true); return; }
      setError(requestError.response?.data?.message || firebaseErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="auth-card p-6 sm:p-8">
        <Link to="/login" className="inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-[#65ff45]"><ArrowLeft size={16} /> Back to sign in</Link>
        {!sent ? (
          <>
            <div className="mt-8 grid h-12 w-12 place-items-center rounded-2xl border border-[#39ff14]/25 bg-[#39ff14]/10 text-[#65ff45]"><KeyRound size={22} /></div>
            <h1 className="mt-5 font-[Space_Grotesk] text-3xl font-bold">Reset your password</h1>
            <p className="mt-3 text-sm leading-6 text-zinc-400">Enter the email attached to your StudyGenie account and we’ll send a secure 15-minute reset link.</p>
            {error && <p role="alert" className="mt-5 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
            <form onSubmit={submit} className="mt-7 space-y-4">
              <div className="auth-field"><Mail className="pointer-events-none absolute left-4 top-[18px] z-10 text-zinc-500" size={18} /><input id="forgot-email" type="email" placeholder=" " value={email} onChange={(event) => setEmail(event.target.value)} required /><label htmlFor="forgot-email">Email address</label></div>
              <button disabled={loading} className="auth-primary w-full disabled:bg-zinc-700 disabled:text-zinc-400">{loading ? "Sending reset link…" : <>Send reset link <Send size={17} /></>}</button>
            </form>
          </>
        ) : (
          <div className="py-10 text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#39ff14]/15 text-[#65ff45]"><CheckCircle2 size={32} /></span>
            <h1 className="mt-6 font-[Space_Grotesk] text-3xl font-bold">Check your inbox</h1>
            <p className="mt-3 text-sm leading-6 text-zinc-400">If an account exists for <span className="text-zinc-200">{email}</span>, a secure password reset link is on its way.</p>
            {developmentToken && <button onClick={() => navigate(`/reset-password/${developmentToken}`)} className="auth-secondary mt-6 w-full">Open local reset link</button>}
            <Link to="/login" className="auth-primary mt-4 w-full">Return to sign in</Link>
          </div>
        )}
      </motion.div>
    </AuthLayout>
  );
}
