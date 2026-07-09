import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const handleSubmit = (event) => {
    event.preventDefault();
    navigate("/login");
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center bg-slate-100 px-4 py-10">
      <div className="grid w-full overflow-hidden rounded-[36px] bg-white shadow-card lg:grid-cols-[1fr_1.1fr]">
        <div className="bg-slate-900 p-8 text-white sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-400">
            Join now
          </p>
          <h2 className="mt-4 text-3xl font-semibold">
            Create your StudyGenie account.
          </h2>
          <p className="mt-4 text-sm leading-7 text-slate-400">
            Build a smarter routine with notes, quizzes, flashcards, and AI
            guidance.
          </p>
        </div>
        <div className="p-8 sm:p-10">
          <h3 className="text-2xl font-semibold text-slate-950">
            Create account
          </h3>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Full name"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
            />
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
              Get started
            </button>
          </form>
          <p className="mt-4 text-sm text-slate-600">
            Already have an account?{" "}
            <Link to="/login" className="font-semibold text-violet-600">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;
