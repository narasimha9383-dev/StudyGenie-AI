import { useState } from "react";

function FlashcardGenerator() {
  const [topic, setTopic] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    alert(`Generating flashcards for ${topic || "your topic"}`);
  };

  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
        Generate
      </p>
      <h3 className="mt-3 text-xl font-semibold text-slate-950">
        Create a new deck
      </h3>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="Topic or chapter"
          className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
        />
        <button
          type="submit"
          className="rounded-full bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-700"
        >
          Generate flashcards
        </button>
      </form>
    </div>
  );
}

export default FlashcardGenerator;
