import { useState } from "react";

function ProfileForm() {
  const [form, setForm] = useState({
    name: "Ananya",
    email: "ananya@example.com",
    goal: "Finish 3 study sessions",
  });

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    alert("Profile updated");
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-[28px] border border-slate-200 bg-white p-6 shadow-card"
    >
      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-700">
          Name
        </label>
        <input
          name="name"
          value={form.name}
          onChange={handleChange}
          className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
        />
      </div>
      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-700">
          Email
        </label>
        <input
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange}
          className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
        />
      </div>
      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-700">
          Study goal
        </label>
        <textarea
          name="goal"
          value={form.goal}
          onChange={handleChange}
          rows={3}
          className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
        />
      </div>
      <button
        type="submit"
        className="rounded-full bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-700"
      >
        Save profile
      </button>
    </form>
  );
}

export default ProfileForm;
