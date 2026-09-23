function ChatMessage({ role = "assistant", content }) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-[24px] px-4 py-3 text-sm leading-6 shadow-sm ${isUser ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-700"}`}
      >
        {content}
      </div>
    </div>
  );
}

export default ChatMessage;
