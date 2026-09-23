function SubjectProgress() {
  const subjects = [
    { name: "Physics", progress: 82 },
    { name: "Chemistry", progress: 68 },
    { name: "History", progress: 74 },
  ];

  return (
    <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-500">
          Subject progress
        </p>
        <h3 className="mt-3 text-xl font-semibold text-slate-950">
          Keep learning steady
        </h3>
      </div>

      <div className="mt-6 space-y-4">
        {subjects.map((subject) => (
          <div key={subject.name}>
            <div className="mb-2 flex items-center justify-between text-sm text-slate-600">
              <span>{subject.name}</span>
              <span className="font-semibold text-slate-900">
                {subject.progress}%
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-slate-100">
              <div
                className="h-2.5 rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                style={{ width: `${subject.progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default SubjectProgress;
