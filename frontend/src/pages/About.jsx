function About() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="rounded-[36px] border border-slate-200 bg-white p-8 shadow-card sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
          About StudyGenie
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-slate-950 sm:text-4xl">
          Built to make studying feel lighter and smarter.
        </h1>
        <p className="mt-5 text-base leading-8 text-slate-600">
          StudyGenie brings together notes, quizzes, flashcards, and AI support
          so students can stay organized and focused without friction.
        </p>
      </div>
    </div>
  );
}

export default About;
