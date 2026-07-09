function ThemeSettings() {
  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
        Appearance
      </p>
      <h3 className="mt-3 text-xl font-semibold text-slate-950">
        Choose your experience
      </h3>
      <div className="mt-6 flex flex-wrap gap-3">
        {["Light", "Dark", "System"].map((option) => (
          <button
            key={option}
            className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

export default ThemeSettings;
