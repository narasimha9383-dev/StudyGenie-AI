function Calendar() {
  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
        Planner
      </p>
      <h3 className="mt-3 text-xl font-semibold text-slate-950">
        Upcoming sessions
      </h3>
      <div className="mt-6 space-y-3">
        {[
          { day: "Mon", task: "Review math formulas" },
          { day: "Wed", task: "Practice coding exercises" },
          { day: "Fri", task: "Prepare for biology quiz" },
        ].map((item) => (
          <div
            key={item.day}
            className="flex items-center justify-between rounded-[20px] bg-slate-50 px-4 py-3"
          >
            <span className="font-semibold text-slate-900">{item.day}</span>
            <span className="text-sm text-slate-600">{item.task}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Calendar;
