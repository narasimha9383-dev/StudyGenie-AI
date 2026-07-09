import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Sparkles,
  UserRound,
} from "lucide-react";

const RegisterForm = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (event) => {
    event.preventDefault();
    navigate("/dashboard");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="w-full"
    >
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.32em] text-sky-600">
          Create account
        </p>
        <h2 className="mt-3 text-3xl font-semibold text-slate-950">
          Start learning smarter
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          Build a calm, high-impact study routine with AI notes, quizzes, and
          progress insights.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            Full name
          </span>
          <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm transition focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/20">
            <UserRound size={18} className="text-slate-400" />
            <input
              placeholder="Alex Morgan"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="ml-3 w-full border-none bg-transparent text-sm outline-none"
            />
          </div>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            Email
          </span>
          <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm transition focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/20">
            <Mail size={18} className="text-slate-400" />
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="ml-3 w-full border-none bg-transparent text-sm outline-none"
            />
          </div>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            Password
          </span>
          <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm transition focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/20">
            <Lock size={18} className="text-slate-400" />
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Create a strong password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="ml-3 w-full border-none bg-transparent text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="text-slate-400 transition hover:text-slate-600"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>

        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-full bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-700"
        >
          Create account
          <ArrowRight size={16} />
        </button>

        <button
          type="button"
          className="flex w-full items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          Continue with Google
        </button>
      </form>

      <div className="mt-8 rounded-[28px] border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-blue-50 p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-600 text-white shadow-lg shadow-sky-500/20">
            <Sparkles size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Already part of the journey?
            </p>
            <p className="text-xs leading-6 text-slate-500">
              Sign in and continue where you left off.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate("/login")}
          className="mt-4 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Sign in instead
        </button>
      </div>
    </motion.div>
  );
};

export default RegisterForm;
