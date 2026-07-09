function ProfileCard() {
  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-100 text-lg font-semibold text-violet-700">
          A
        </div>
        <div>
          <p className="text-xl font-semibold text-slate-950">Ananya Sharma</p>
          <p className="text-sm text-slate-500">Student • Computer Science</p>
        </div>
      </div>
    </div>
  );
}

export default ProfileCard;
