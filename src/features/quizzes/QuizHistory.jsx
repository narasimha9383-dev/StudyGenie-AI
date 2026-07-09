function QuizHistory() {
  const history = [
    { title: "Data structures", score: "9/10" },
    { title: "Algorithms", score: "8/10" },
  ];

  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
        Quiz history
      </p>
      <div className="mt-6 space-y-3">
        {history.map((item) => (
          <div
            key={item.title}
            className="flex items-center justify-between rounded-[20px] bg-slate-50 px-4 py-3"
          >
            <span className="font-semibold text-slate-900">{item.title}</span>
            <span className="text-sm font-semibold text-violet-600">
              {item.score}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default QuizHistory;
