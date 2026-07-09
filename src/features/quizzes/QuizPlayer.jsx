function QuizPlayer() {
  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
        Quiz player
      </p>
      <h3 className="mt-3 text-xl font-semibold text-slate-950">
        What is a closure in JavaScript?
      </h3>
      <div className="mt-6 space-y-3">
        {[
          "A function that closes over variables",
          "A DOM event",
          "A CSS class",
        ].map((choice) => (
          <button
            key={choice}
            className="flex w-full items-center rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm text-slate-700 transition hover:border-violet-200 hover:bg-violet-50"
          >
            {choice}
          </button>
        ))}
      </div>
    </div>
  );
}

export default QuizPlayer;
