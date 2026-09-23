function PrivacySettings() {
  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
        Privacy
      </p>
      <h3 className="mt-3 text-xl font-semibold text-slate-950">
        Sharing controls
      </h3>
      <div className="mt-6 space-y-3 text-sm text-slate-600">
        <div className="flex items-center justify-between rounded-[20px] bg-slate-50 px-4 py-3">
          <span>Profile visible to others</span>
          <span className="font-semibold text-emerald-600">On</span>
        </div>
        <div className="flex items-center justify-between rounded-[20px] bg-slate-50 px-4 py-3">
          <span>Study analytics shared</span>
          <span className="font-semibold text-slate-900">Limited</span>
        </div>
      </div>
    </div>
  );
}

export default PrivacySettings;
