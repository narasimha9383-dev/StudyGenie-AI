import { useContext, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthContext } from "../../context/AuthContext";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const { login } = useContext(AuthContext);

  const handleSubmit = (event) => {
    event.preventDefault();
    login(email || "student");
    navigate("/dashboard");
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center bg-slate-100 px-4 py-10">
      <div className="grid w-full overflow-hidden rounded-[36px] bg-white shadow-card lg:grid-cols-[1.1fr_0.9fr]">
        <div className="bg-gradient-to-br from-violet-600 to-indigo-600 p-8 text-white sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-100">
            Welcome back
          </p>
          <h2 className="mt-4 text-3xl font-semibold">
            Sign in to continue your study journey.
          </h2>
          <p className="mt-4 text-sm leading-7 text-violet-100">
            Track progress, summarize notes, and get help from your AI tutor in
            one place.
          </p>
        </div>
        <div className="p-8 sm:p-10">
          <h3 className="text-2xl font-semibold text-slate-950">Log in</h3>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
            />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
            />
            <button
              type="submit"
              className="w-full rounded-full bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-700"
            >
              Continue
            </button>
          </form>
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <Link to="/forgot-password" className="font-medium text-violet-600">
              Forgot password?
            </Link>
            <Link to="/register" className="font-medium text-violet-600">
              Create account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
