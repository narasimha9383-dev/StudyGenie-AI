import { PlayCircle } from "lucide-react";

function ContinueLearning() {
  return (
    <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
            Continue learning
          </p>
          <h3 className="mt-3 text-xl font-semibold text-slate-950">
            Deep dive into algorithms
          </h3>
        </div>
        <button className="rounded-full bg-violet-50 p-3 text-violet-600 transition hover:bg-violet-100">
          <PlayCircle size={18} />
        </button>
      </div>

      <p className="mt-5 text-sm leading-6 text-slate-600">
        Resume your last session and pick up from the most recent concept with a
        focused review.
      </p>

      <div className="mt-6 flex items-center justify-between rounded-[24px] bg-slate-50 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            Lesson 4 • Arrays
          </p>
          <p className="mt-1 text-xs text-slate-500">45 minutes left</p>
        </div>
        <div className="text-sm font-semibold text-violet-600">78%</div>
      </div>
    </section>
  );
}

export default ContinueLearning;
