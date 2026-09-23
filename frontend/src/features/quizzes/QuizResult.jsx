function QuizResult({ score = 8, total = 10 }) {
  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
        Results
      </p>
      <h3 className="mt-3 text-xl font-semibold text-slate-950">
        You scored {score}/{total}
      </h3>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Great job — you are building strong understanding with each quiz.
      </p>
    </div>
  );
}

export default QuizResult;
