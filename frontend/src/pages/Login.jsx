import { useContext, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import AuthLayout from "../layouts/AuthLayout";
import GoogleSignIn from "../components/forms/GoogleSignIn";
import api from "../api/axios";
import { firebaseConfigured } from "../firebase/firebase";
import { firebaseErrorMessage, firebaseLogin } from "../services/firebaseAuth";
import { exchangeFirebaseSession } from "../services/authBridge";

const canFallbackToLegacy = (error) => ["firebase/not-configured", "auth/user-not-found", "auth/invalid-credential", "auth/wrong-password", "auth/operation-not-allowed"].includes(error?.code);

export default function Login() {
  const navigate = useNavigate();
  const { login } = useContext(AuthContext);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const notice = sessionStorage.getItem("authNotice");
    if (notice) { setError(notice); sessionStorage.removeItem("authNotice"); }
  }, []);

  const finish = ({ user, token }) => {
    login(user, token, remember);
    setSuccess("Welcome back. Opening your learning workspace…");
    window.setTimeout(() => navigate("/dashboard"), 700);
  };

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (firebaseConfigured) {
        try {
          const firebaseUser = await firebaseLogin(email, password, remember);
          let pendingProfile = {};
          try { pendingProfile = JSON.parse(sessionStorage.getItem("pendingProfile") || "{}"); } catch { pendingProfile = {}; }
          finish(await exchangeFirebaseSession(firebaseUser, pendingProfile));
          sessionStorage.removeItem("pendingProfile");
          return;
        } catch (firebaseError) {
          if (!canFallbackToLegacy(firebaseError)) throw firebaseError;
        }
      }
      const { data } = await api.post("/auth/login", { email, password });
      finish(data);
    } catch (requestError) {
      const status = requestError.response?.status;
      const message = requestError.response?.data?.message;
      setError(status >= 500 || requestError.code === "ERR_NETWORK" || requestError.code === "ECONNABORTED"
        ? "The server is unavailable. Start MongoDB and the backend, then try again."
        : message || firebaseErrorMessage(requestError));
    } finally { setLoading(false); }
  };

  return <AuthLayout><motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="auth-card p-6 sm:p-8"><div className="flex items-center gap-2 text-[#65ff45]"><Sparkles size={17} /><span className="text-xs font-semibold uppercase tracking-[.2em]">Secure sign in</span></div><h1 className="mt-5 font-[Space_Grotesk] text-3xl font-bold">Welcome back</h1><p className="mt-3 text-sm leading-6 text-zinc-400">Sign in to continue your personalized study journey.</p>{error && <p role="alert" className="mt-5 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}{success && <p role="status" className="mt-5 flex items-center gap-2 rounded-xl border border-[#39ff14]/25 bg-[#39ff14]/10 p-3 text-sm text-[#65ff45]"><CheckCircle2 size={17} />{success}</p>}<form onSubmit={submit} className="mt-7 space-y-4"><div className="auth-field"><Mail className="pointer-events-none absolute left-4 top-[18px] z-10 text-zinc-500" size={18} /><input id="login-email" type="email" placeholder=" " value={email} onChange={(event) => setEmail(event.target.value)} required /><label htmlFor="login-email">Email address</label></div><div className="auth-field"><LockKeyhole className="pointer-events-none absolute left-4 top-[18px] z-10 text-zinc-500" size={18} /><input id="login-password" type={show ? "text" : "password"} placeholder=" " value={password} onChange={(event) => setPassword(event.target.value)} required /><label htmlFor="login-password">Password</label><button type="button" onClick={() => setShow(!show)} className="absolute right-4 top-[17px] text-zinc-500 hover:text-[#65ff45]" aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div><div className="flex items-center justify-between text-sm"><label className="flex cursor-pointer items-center gap-2 text-zinc-400"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="accent-[#39ff14]" />Remember me</label><Link to="/forgot-password" className="text-[#65ff45] hover:underline">Forgot password?</Link></div><button disabled={loading || Boolean(success)} className="auth-primary w-full disabled:bg-zinc-700 disabled:text-zinc-400">{loading ? <span className="animate-pulse">Signing in…</span> : <>Sign in <ArrowRight size={17} /></>}</button></form><div className="my-6 flex items-center gap-3 text-xs text-zinc-600"><span className="h-px flex-1 bg-white/10" />OR<span className="h-px flex-1 bg-white/10" /></div><GoogleSignIn remember={remember} onSuccess={finish} onError={setError} /><p className="mt-7 text-center text-sm text-zinc-400">New to StudyGenie? <Link to="/register" className="font-semibold text-[#65ff45] hover:underline">Create an account</Link></p></motion.div></AuthLayout>;
}
