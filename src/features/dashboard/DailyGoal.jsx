import { Target } from "lucide-react";

const DailyGoal = () => {
  return (
    <section className="rounded-[32px] border border-slate-200/80 bg-white p-6 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-500">
            Daily goal
          </p>
          <h3 className="mt-3 text-xl font-semibold text-slate-950">
            Complete 3 sessions
          </h3>
        </div>
        <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600">
          <Target size={20} />
        </div>
      </div>

      <div className="mt-6 rounded-[24px] bg-slate-50 p-4">
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>Progress</span>
          <span className="font-semibold text-slate-900">2/3 done</span>
        </div>
        <div className="mt-3 h-2.5 rounded-full bg-slate-200">
          <div className="h-2.5 w-2/3 rounded-full bg-emerald-500" />
        </div>
      </div>
    </section>
  );
};

export default DailyGoal;
