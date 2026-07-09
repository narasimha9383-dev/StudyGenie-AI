import { useContext, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Lock, Mail, Sparkles } from "lucide-react";
import { AuthContext } from "../context/AuthContext";
import AuthLayout from "../layouts/AuthLayout";

function Login() {
  const navigate = useNavigate();
  const { login } = useContext(AuthContext);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = (event) => {
    event.preventDefault();
    login(email || "student");
    navigate("/dashboard");
  };

  return (
    <AuthLayout>
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full"
      >
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.32em] text-sky-600">
            Sign in
          </p>
          <h2 className="mt-3 text-3xl font-semibold text-slate-950">
            Log in to continue
          </h2>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            Access your study workspace, AI tutor, and personalized progress
            dashboard.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">
              Email
            </span>
            <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm transition focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/20">
              <Mail size={18} className="text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
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
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
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
            Login
            <ArrowRight size={16} />
          </button>

          <button
            type="button"
            className="flex w-full items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Continue with Google
          </button>
        </form>

        <div className="mt-5 text-center text-sm text-slate-500">
          <a href="/forgot-password" className="font-semibold text-sky-600">
            Forgot password?
          </a>
        </div>

        <div className="mt-8 rounded-[28px] border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-blue-50 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-600 text-white shadow-lg shadow-sky-500/20">
              <Sparkles size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">
                New to StudyGenie AI?
              </p>
              <p className="text-xs leading-6 text-slate-500">
                Unlock AI-powered notes, quizzes, and smarter study plans.
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate("/register")}
            className="mt-4 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Create Free Account
          </button>
        </div>
      </motion.div>
    </AuthLayout>
  );
}

export default Login;
