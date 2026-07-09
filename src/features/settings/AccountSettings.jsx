function AccountSettings() {
  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
        Account
      </p>
      <h3 className="mt-3 text-xl font-semibold text-slate-950">
        Personal details
      </h3>
      <div className="mt-6 space-y-4 text-sm text-slate-600">
        <div className="flex items-center justify-between rounded-[20px] bg-slate-50 px-4 py-3">
          <span>Name</span>
          <span className="font-semibold text-slate-900">Ananya Sharma</span>
        </div>
        <div className="flex items-center justify-between rounded-[20px] bg-slate-50 px-4 py-3">
          <span>Email</span>
          <span className="font-semibold text-slate-900">
            ananya@example.com
          </span>
        </div>
      </div>
    </div>
  );
}

export default AccountSettings;
