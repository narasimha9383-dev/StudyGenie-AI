function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="rounded-[24px] bg-slate-100 px-4 py-3 text-sm text-slate-600 shadow-sm">
        <div className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:120ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:240ms]" />
        </div>
      </div>
    </div>
  );
}

export default TypingIndicator;
