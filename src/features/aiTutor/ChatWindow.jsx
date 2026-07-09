import { useState } from "react";
import { SendHorizonal } from "lucide-react";
import ChatMessage from "./ChatMessage";
import TypingIndicator from "./TypingIndicator";

function ChatWindow() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hi! I can explain concepts, make quiz questions, and help you review notes.",
    },
  ]);
  const [draft, setDraft] = useState("");

  const handleSend = (event) => {
    event.preventDefault();
    if (!draft.trim()) return;

    setMessages((current) => [
      ...current,
      { role: "user", content: draft.trim() },
    ]);
    setDraft("");
  };

  return (
    <div className="flex h-[70vh] flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-card">
      <div className="border-b border-slate-200 p-5">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
          AI tutor
        </p>
        <h2 className="mt-2 text-xl font-semibold text-slate-950">
          Ask anything
        </h2>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {messages.map((message, index) => (
          <ChatMessage
            key={`${message.role}-${index}`}
            role={message.role}
            content={message.content}
          />
        ))}
        <TypingIndicator />
      </div>

      <form onSubmit={handleSend} className="border-t border-slate-200 p-4">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-slate-50 px-4 py-3">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask your tutor..."
            className="flex-1 border-none bg-transparent text-sm outline-none"
          />
          <button
            type="submit"
            className="rounded-full bg-violet-600 p-2 text-white"
          >
            <SendHorizonal size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}

export default ChatWindow;
