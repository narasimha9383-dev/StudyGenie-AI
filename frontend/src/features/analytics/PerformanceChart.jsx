function PerformanceChart() {
  const data = [40, 70, 55, 85, 90, 78];

  return (
    <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-6 shadow-card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-500">
            Performance
          </p>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">
            Weekly trend
          </h3>
        </div>
      </div>

      <div className="mt-6 flex h-44 items-end gap-3">
        {data.map((value, index) => (
          <div
            key={`${value}-${index}`}
            className="flex flex-1 flex-col items-center gap-2"
          >
            <div
              className="w-full rounded-t-[16px] bg-gradient-to-t from-violet-600 to-indigo-500"
              style={{ height: `${value}%` }}
            />
            <span className="text-xs text-slate-500">D{index + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default PerformanceChart;
