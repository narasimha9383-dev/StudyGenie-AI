import { useState } from "react";

function ForgotPassword() {
  const [email, setEmail] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    alert(`Reset instructions sent to ${email || "your email"}`);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full rounded-[32px] border border-slate-200 bg-white p-8 shadow-card">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
          Reset password
        </p>
        <h2 className="mt-4 text-2xl font-semibold text-slate-950">
          Forgot your password?
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Enter your email and we will send a link to help you recover access.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
          />
          <button
            type="submit"
            className="w-full rounded-full bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-700"
          >
            Send reset link
          </button>
        </form>
      </div>
    </div>
  );
}

export default ForgotPassword;
