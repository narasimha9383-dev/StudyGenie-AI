import { Sparkles, TrendingUp } from "lucide-react";

function AIInsights() {
  return (
    <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
            AI insights
          </p>
          <h3 className="mt-3 text-xl font-semibold text-slate-950">
            Your learning pulse
          </h3>
        </div>
        <div className="rounded-2xl bg-violet-50 p-3 text-violet-600">
          <Sparkles size={18} />
        </div>
      </div>

      <div className="mt-6 rounded-[24px] bg-gradient-to-br from-violet-600 to-indigo-600 p-5 text-white">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-violet-100">Suggested focus</p>
            <p className="mt-2 text-lg font-semibold">
              Practice 2 more calculus sets
            </p>
          </div>
          <div className="rounded-2xl bg-white/15 p-3">
            <TrendingUp size={18} />
          </div>
        </div>
      </div>
    </section>
  );
}

export default AIInsights;
