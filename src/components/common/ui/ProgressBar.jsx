function ProgressBar({ value = 0, label, color = "bg-violet-600" }) {
  const safeValue = Math.min(100, Math.max(0, value));

  return (
    <div className="w-full">
      {label && (
        <div className="mb-2 flex items-center justify-between text-sm text-slate-600">
          <span>{label}</span>
          <span className="font-semibold text-slate-900">{safeValue}%</span>
        </div>
      )}
      <div className="h-2.5 rounded-full bg-slate-100">
        <div
          className={`h-2.5 rounded-full ${color}`}
          style={{ width: `${safeValue}%` }}
        />
      </div>
    </div>
  );
}

export default ProgressBar;
