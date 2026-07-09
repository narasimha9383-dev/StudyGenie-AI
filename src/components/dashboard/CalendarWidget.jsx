import { CalendarDays } from "lucide-react";

function CalendarWidget() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <section className="rounded-[30px] border border-slate-200 bg-slate-50 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-500">
            Calendar
          </p>
          <h3 className="mt-3 text-xl font-semibold text-slate-950">
            This week
          </h3>
        </div>
        <div className="rounded-2xl bg-white p-3 text-slate-700 shadow-sm">
          <CalendarDays size={18} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-7 gap-2 text-center text-sm">
        {days.map((day) => (
          <div key={day} className="text-slate-400">
            {day}
          </div>
        ))}
        {[2, 3, 4, 5, 6, 7, 8].map((day) => (
          <div
            key={day}
            className={`rounded-2xl p-2 ${day === 5 ? "bg-violet-600 text-white" : "bg-white text-slate-700"}`}
          >
            {day}
          </div>
        ))}
      </div>
    </section>
  );
}

export default CalendarWidget;
