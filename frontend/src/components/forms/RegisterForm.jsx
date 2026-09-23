import { useContext, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, School, UserRound } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import GoogleSignIn from "./GoogleSignIn";
import AuthLayout from "../../layouts/AuthLayout";
import api from "../../api/axios";
import { AuthContext } from "../../context/AuthContext";
import { firebaseConfigured } from "../../firebase/firebase";
import { firebaseErrorMessage, firebaseLogout, firebaseRegister } from "../../services/firebaseAuth";

const strength = (password) => password.length >= 12 ? "Strong" : password.length >= 8 ? "Good" : "Use 8+ characters";

export default function RegisterForm() {
  const navigate = useNavigate();
  const { login } = useContext(AuthContext);
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "", college: "", course: "", year: "" });
  const [show, setShow] = useState(false);
  const [terms, setTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const update = (key, value) => setForm((data) => ({ ...data, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (form.password !== form.confirm) return setError("Passwords do not match.");
    if (!terms) return setError("Accept the terms to create an account.");
    setLoading(true); setError("");
    try {
      if (firebaseConfigured) {
        await firebaseRegister({ name: form.name, email: form.email, password: form.password });
        sessionStorage.setItem("pendingProfile", JSON.stringify({ college: form.college, course: form.course, year: form.year }));
        await firebaseLogout().catch(() => {});
      } else {
        await api.post("/auth/register", form);
      }
      setSuccess(true);
    } catch (requestError) {
      setError(requestError.response?.data?.message || firebaseErrorMessage(requestError));
    } finally { setLoading(false); }
  };

  const finishGoogle = ({ user, token }) => { login(user, token, true); navigate("/dashboard"); };
  const field = (id, label, Icon, type = "text", required = true) => <div className="auth-field"><Icon className="pointer-events-none absolute left-4 top-[18px] z-10 text-zinc-500" size={18} /><input id={id} type={type} placeholder=" " value={form[id]} onChange={(event) => update(id, event.target.value)} required={required} /><label htmlFor={id}>{label}</label></div>;

  return <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="auth-card p-6 sm:p-8"><p className="text-xs font-semibold uppercase tracking-[.2em] text-[#65ff45]">Create your workspace</p><h1 className="mt-4 font-[Space_Grotesk] text-3xl font-bold">Start learning smarter</h1><p className="mt-3 text-sm leading-6 text-zinc-400">Build a private AI study space around your goals.</p>{error && <p role="alert" className="mt-5 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}<form onSubmit={submit} className="mt-7 space-y-4">{field("name", "Full name", UserRound)}{field("email", "Email address", Mail, "email")}<div className="auth-field"><LockKeyhole className="pointer-events-none absolute left-4 top-[18px] z-10 text-zinc-500" size={18} /><input id="password" type={show ? "text" : "password"} placeholder=" " value={form.password} onChange={(event) => update("password", event.target.value)} required minLength="8" /><label htmlFor="password">Password</label><button type="button" onClick={() => setShow(!show)} className="absolute right-4 top-[17px] text-zinc-500" aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div><p className="-mt-2 text-xs text-zinc-500">Password strength: <b className="text-[#65ff45]">{strength(form.password)}</b> · At least 8 characters</p><div className="auth-field"><LockKeyhole className="pointer-events-none absolute left-4 top-[18px] z-10 text-zinc-500" size={18} /><input id="confirm" type={show ? "text" : "password"} placeholder=" " value={form.confirm} onChange={(event) => update("confirm", event.target.value)} required /><label htmlFor="confirm">Confirm password</label></div><details className="rounded-xl border border-white/10 bg-white/[.025] p-3"><summary className="cursor-pointer text-sm text-zinc-300">Optional learning profile</summary><div className="mt-3 grid gap-3">{field("college", "College", School, "text", false)}{field("course", "Course or branch", School, "text", false)}<select value={form.year} onChange={(event) => update("year", event.target.value)} className="rounded-xl border border-white/10 bg-white/[.04] p-3 text-sm text-zinc-300"><option value="">Year of study (optional)</option><option>First Year</option><option>Second Year</option><option>Third Year</option><option>Final Year</option></select></div></details><label className="flex gap-2 text-xs leading-5 text-zinc-400"><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} className="mt-1 accent-[#39ff14]" />I agree to the Terms of Service and Privacy Policy.</label><button disabled={loading} className="auth-primary w-full disabled:bg-zinc-700">{loading ? "Creating account…" : "Create account"}</button></form><div className="my-6 flex items-center gap-3 text-xs text-zinc-600"><span className="h-px flex-1 bg-white/10" />OR<span className="h-px flex-1 bg-white/10" /></div><GoogleSignIn onSuccess={finishGoogle} onError={setError} /><p className="mt-7 text-center text-sm text-zinc-400">Already have an account? <Link to="/login" className="font-semibold text-[#65ff45] hover:underline">Sign in</Link></p>{success && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"><motion.div role="dialog" aria-modal="true" initial={{ opacity: 0, scale: .92 }} animate={{ opacity: 1, scale: 1 }} className="auth-card w-full max-w-sm p-7 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#39ff14]/15 text-[#65ff45]"><CheckCircle2 size={30} /></span><h2 className="mt-5 text-2xl font-bold">Account created</h2><p className="mt-3 text-sm leading-6 text-zinc-400">Verify your email, then sign in to continue.</p><button onClick={() => navigate("/login")} className="auth-primary mt-7 w-full">Go to sign in</button></motion.div></div>}</motion.div>;
}
