import { Flame } from "lucide-react";

function StudyStreak() {
  return (
    <section className="rounded-[30px] border border-slate-200 bg-gradient-to-br from-amber-400 to-orange-500 p-6 text-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-amber-100">
            Study streak
          </p>
          <h3 className="mt-3 text-xl font-semibold">7 days strong</h3>
        </div>
        <div className="rounded-2xl bg-white/20 p-3">
          <Flame size={18} />
        </div>
      </div>

      <p className="mt-5 text-sm leading-6 text-amber-50">
        You are building momentum. Keep the streak alive with one focused
        session today.
      </p>
    </section>
  );
}

export default StudyStreak;
