import PerformanceChart from "./PerformanceChart";

function StudyAnalytics() {
  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
          Analytics
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-slate-950">
          Study habits overview
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          You are maintaining strong consistency with a healthy balance of study
          time and review.
        </p>
      </div>
      <PerformanceChart />
    </div>
  );
}

export default StudyAnalytics;
