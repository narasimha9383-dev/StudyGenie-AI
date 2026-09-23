import { useState } from "react";

function Flashcard({ question, answer }) {
  const [flipped, setFlipped] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setFlipped((value) => !value)}
      className="w-full rounded-[28px] border border-slate-200 bg-white p-6 text-left shadow-card transition hover:-translate-y-1"
    >
      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
        Flashcard
      </p>
      <p className="mt-4 text-lg font-semibold text-slate-950">
        {flipped ? answer : question}
      </p>
    </button>
  );
}

export default Flashcard;
