function WeeklyReport() {
  const stats = [
    { label: "Study hours", value: "14.5h" },
    { label: "Quizzes", value: "9" },
    { label: "Accuracy", value: "87%" },
  ];

  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
        Weekly report
      </p>
      <h3 className="mt-3 text-xl font-semibold text-slate-950">
        Progress snapshot
      </h3>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-[24px] bg-slate-50 p-4">
            <p className="text-sm text-slate-500">{stat.label}</p>
            <p className="mt-3 text-2xl font-semibold text-slate-950">
              {stat.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default WeeklyReport;
