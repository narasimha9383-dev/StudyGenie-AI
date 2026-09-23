function PromptSuggestions({ onSelect }) {
  const suggestions = [
    "Explain a difficult topic",
    "Create a quiz from my notes",
    "Summarize this chapter",
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onSelect?.(suggestion)}
          className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}

export default PromptSuggestions;
