import { useEffect, useRef, useState } from "react";
import {
  Bot,
  CornerDownLeft,
  MessageSquareText,
  Sparkles,
  Zap,
  Cloud,
} from "lucide-react";
import { Link } from "react-router-dom";
import api from "../api/axios";

const prompts = [
  "Explain this topic from my material",
  "Summarize the most important concepts",
  "Give me an example based on my PDFs",
];

const LLM_PROVIDERS = {
  local: {
    name: "Local (Qwen 3.5)",
    description:
      "Fast local LLM • Runs on your device • No API calls • Privacy-first",
    icon: Zap,
    badge: "Local",
    badgeColor: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    speed: "Fast",
    privacy: "Private",
  },
  openrouter: {
    name: "OpenRouter (Premium)",
    description:
      "Advanced cloud models • Better reasoning • Higher accuracy • API-based",
    icon: Cloud,
    badge: "Cloud",
    badgeColor: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    speed: "Balanced",
    privacy: "Encrypted",
  },
  groq: {
    name: "Groq (GPT-OSS 20B)",
    description:
      "Fast hosted inference • OpenAI-compatible • Requires backend GROQ_API_KEY",
    icon: Zap,
    badge: "Groq",
    badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    speed: "Very fast",
    privacy: "Encrypted",
  },
};

export default function Chatbot() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hi — I’m your AI Tutor. Ask a question about the study material you have uploaded.",
      llm_provider: "local",
      llm_model: "Qwen 3.5",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [readyCount, setReadyCount] = useState(null);
  const [processedPdfs, setProcessedPdfs] = useState([]);
  const [selectedPdfId, setSelectedPdfId] = useState("");
  const [selectedLlmProvider, setSelectedLlmProvider] = useState("local");
  const [libraryError, setLibraryError] = useState("");
  const [llmSettings, setLlmSettings] = useState(false);
  const bottomRef = useRef(null);

  // Never return the result of an async operation (or a DOM method) from an
  // effect. React treats any returned value as a cleanup function; returning
  // a Promise here causes the blank-screen `destroy is not a function` crash
  // during route changes/unmounts.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    let mounted = true;

    const loadProcessedMaterials = async () => {
      try {
        const { data } = await api.get("/pdf");
        if (mounted) {
          const completed = data.filter(
            (pdf) => pdf.status === "completed" && pdf.ragReady !== false,
          );
          setProcessedPdfs(completed);
          setReadyCount(completed.length);
          setSelectedPdfId((current) => current || completed[0]?._id || "");
        }
      } catch (error) {
        if (mounted) {
          setLibraryError(
            error.response?.data?.message ||
              "Could not check processed study material.",
          );
          setReadyCount(0);
        }
      }
    };

    loadProcessedMaterials();
    return () => {
      mounted = false;
    };
  }, []);

  const send = async (value = input) => {
    const question = value.trim();
    if (!question || loading) return;
    if (readyCount === 0) {
      setMessages((items) => [
        ...items,
        { role: "user", content: question },
        {
          role: "assistant",
          content:
            "Please finish processing a text-based PDF before using AI Tutor.",
        },
      ]);
      setInput("");
      return;
    }

    setMessages((items) => [...items, { role: "user", content: question }]);
    setInput("");
    setLoading(true);
    try {
      const { data } = await api.post("/chat", {
        question,
        pdfId: selectedPdfId || undefined,
        llmProvider: selectedLlmProvider || undefined,
      });
      setMessages((items) => [
        ...items,
        {
          role: "assistant",
          content: data.answer || "I could not generate a response.",
          sources: data.sources || [],
          mode: data.mode || "unknown",
          is_from_pdf: data.is_from_pdf === true,
          confidence: data.confidence,
          llm_provider: data.llm_provider || "local",
          llm_model: data.llm_model || "Qwen 3.5",
          llm_used: data.llm_used === true,
        },
      ]);
    } catch (error) {
      setMessages((items) => [
        ...items,
        {
          role: "assistant",
          content:
            error.response?.data?.message ||
            "The AI Tutor is unavailable right now.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const unavailable = readyCount === 0;

  const LLMBadge = ({ message }) => {
    if (
      message.role !== "assistant" ||
      message.mode === "greeting" ||
      message.llm_used !== true ||
      !message.llm_provider
    ) return null;

    const provider = LLM_PROVIDERS[message.llm_provider];
    if (!provider) return null;

    const Icon = provider.icon;
    return (
      <div
        className={`mt-3 inline-flex items-center gap-2 rounded-lg border ${provider.badgeColor} px-2.5 py-1.5 text-xs`}
      >
        <Icon size={14} />
        <span className="font-medium">{provider.badge}</span>
        <span className="text-opacity-70">
          • {message.llm_model || "AI Model"}
        </span>
      </div>
    );
  };

  return (
    <section className="relative mx-auto grid min-h-[calc(100vh-9rem)] max-w-7xl gap-5 overflow-hidden rounded-[24px] bg-[radial-gradient(circle_at_15%_10%,rgba(57,255,20,.12),transparent_30%),radial-gradient(circle_at_85%_90%,rgba(0,200,83,.12),transparent_28%),#101719] p-1 xl:grid-cols-[1fr_320px]">
      <div className="neon-card flex min-h-[620px] flex-col overflow-hidden rounded-[18px] bg-[#111d20]/95">
        <header className="flex items-center justify-between border-b border-white/10 bg-[#142326]/80 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#39ff14]/10 text-[#65ff45]">
              <Bot size={21} />
            </span>
            <div>
              <h1 className="font-semibold text-white">AI Tutor</h1>
              <p className="text-xs text-zinc-400">
                {readyCount === null
                  ? "Checking study material…"
                  : readyCount
                    ? `${readyCount} processed PDF${readyCount > 1 ? "s" : ""}`
                    : "No processed PDFs yet"}
              </p>
            </div>
          </div>
          <span className="rounded-full border border-[#39ff14]/25 bg-[#39ff14]/10 px-3 py-1 text-xs text-[#65ff45]">
            {readyCount ? "Ready" : "Waiting for PDF"}
          </span>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto bg-[#0e181a]/75 px-5 py-6">
          {unavailable && (
            <div className="rounded-xl border border-amber-300/25 bg-amber-300/10 p-4 text-sm text-amber-100">
              Upload and finish processing a text-based PDF before asking the
              Tutor.{" "}
              <Link
                to="/upload"
                className="font-semibold text-[#65ff45] hover:underline"
              >
                Upload PDF
              </Link>
            </div>
          )}
          {libraryError && (
            <div
              role="alert"
              className="rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200"
            >
              {libraryError}
            </div>
          )}
          {processedPdfs.length > 0 && (
            <div className="rounded-xl border border-[#39ff14]/20 bg-[#39ff14]/[.06] p-3">
              <label className="text-xs text-zinc-400" htmlFor="chat-pdf">
                Answer from PDF
              </label>
              <select
                id="chat-pdf"
                value={selectedPdfId}
                onChange={(event) => setSelectedPdfId(event.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-[#0c1517] px-3 py-2 text-sm text-zinc-200"
              >
                {processedPdfs.map((pdf) => (
                  <option key={pdf._id} value={pdf._id}>
                    {pdf.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-7 ${message.role === "user" ? "bg-[#39ff14] text-[#071006]" : "border border-white/10 bg-[#1a292c] text-zinc-100 shadow-[0_8px_24px_rgba(0,0,0,.2)]"}`}
              >
                {message.content}
                {message.role === "assistant" &&
                message.mode === "insufficient_context" ? (
                  <p className="mt-3 border-t border-amber-300/20 pt-2 text-xs text-amber-200">
                    ⚠ The selected PDF does not contain enough matching text for this question. Ask about a term, heading, or sentence from the material.
                  </p>
                ) : message.role === "assistant" &&
                  message.mode === "retrieval_error" ? (
                  <p className="mt-3 border-t border-red-300/20 pt-2 text-xs text-red-200">
                    ⚠ The PDF search is temporarily unavailable. Please try again.
                  </p>
                ) : message.role === "assistant" &&
                  message.mode === "general_tutor" ? (
                  <p className="mt-3 border-t border-blue-300/20 pt-2 text-xs text-blue-200">
                    ℹ This is a general AI explanation; the selected PDF did not contain matching evidence.
                  </p>
                ) : message.role === "assistant" &&
                  message.mode !== "greeting" &&
                  message.is_from_pdf === false ? (
                  <p className="mt-3 border-t border-amber-300/20 pt-2 text-xs text-amber-200">
                    ⚠ This answer is not backed by the selected PDF.
                  </p>
                ) : null}
                {message.role === "assistant" &&
                message.is_from_pdf &&
                typeof message.confidence === "number" ? (
                  <p className="mt-3 border-t border-white/10 pt-2 text-xs text-zinc-400">
                    ✓ Answer found in your PDF · Confidence:{" "}
                    {Math.round(message.confidence * 100)}%
                  </p>
                ) : null}
                {message.sources?.length ? (
                  <p className="mt-3 border-t border-white/10 pt-2 text-xs text-zinc-400">
                    Sources:{" "}
                    {message.sources
                      .map((source) =>
                        source.page_number
                          ? `Page ${source.page_number}`
                          : source.chunk_id,
                      )
                      .join(", ")}
                  </p>
                ) : null}
                <LLMBadge message={message} />
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#39ff14]/10 text-[#65ff45]">
                <Bot size={17} />
              </span>
              <div className="rounded-2xl border border-white/10 bg-[#1a292c] px-4 py-3 text-zinc-300">
                <span className="inline-flex gap-1">
                  <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#65ff45]" />
                  <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#65ff45] [animation-delay:150ms]" />
                  <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#65ff45] [animation-delay:300ms]" />
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="border-t border-white/10 bg-[#142326]/90 p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {prompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => send(prompt)}
                disabled={unavailable || loading}
                className="rounded-full border border-[#39ff14]/20 bg-[#182a2d] px-3 py-1.5 text-xs text-zinc-300 transition hover:border-[#39ff14]/60 hover:text-[#65ff45] disabled:opacity-40"
              >
                {prompt}
              </button>
            ))}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
            className="flex items-center gap-3 rounded-2xl border border-[#39ff14]/20 bg-[#0c1517] p-2 focus-within:border-[#39ff14]/60"
          >
            <MessageSquareText className="ml-2 text-zinc-400" size={18} />
            <input
              disabled={unavailable}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                unavailable
                  ? "Process a PDF first"
                  : "Ask about your study material…"
              }
              className="min-w-0 flex-1 border-0 bg-transparent px-1 py-2 text-sm text-white outline-none placeholder:text-zinc-500"
            />
            <button
              disabled={loading || !input.trim() || unavailable}
              className="grid h-10 w-10 place-items-center rounded-xl bg-[#39ff14] text-[#071006] disabled:bg-zinc-700 disabled:text-zinc-500"
              aria-label="Send message"
            >
              <CornerDownLeft size={18} />
            </button>
          </form>
        </div>
      </div>
      <aside className="space-y-5">
        {/* LLM Settings Card */}
        <article className="neon-card rounded-[18px] bg-[#111d20]/95 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-[#65ff45]">
              <Zap size={17} />
              <h2 className="font-semibold">LLM Provider</h2>
            </div>
            <button
              onClick={() => setLlmSettings(!llmSettings)}
              className="text-xs text-zinc-400 hover:text-zinc-300 transition"
            >
              {llmSettings ? "✕" : "⚙"}
            </button>
          </div>

          {llmSettings ? (
            <div className="space-y-3">
              {Object.entries(LLM_PROVIDERS).map(([key, provider]) => {
                const Icon = provider.icon;
                const isSelected = selectedLlmProvider === key;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedLlmProvider(key)}
                    className={`w-full rounded-lg border-2 p-3 text-left transition ${
                      isSelected
                        ? "border-[#39ff14] bg-[#39ff14]/10"
                        : "border-white/10 bg-[#0c1517] hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon
                        size={16}
                        className="mt-1 flex-shrink-0 text-[#65ff45]"
                      />
                      <div className="flex-1">
                        <div className="font-semibold text-white text-sm">
                          {provider.name}
                        </div>
                        <p className="text-xs text-zinc-400 mt-1">
                          {provider.description}
                        </p>
                        <div className="flex gap-2 mt-2 text-xs">
                          <span className="text-zinc-500">
                            Speed:{" "}
                            <span className="text-zinc-300">
                              {provider.speed}
                            </span>
                          </span>
                          <span className="text-zinc-500">
                            Privacy:{" "}
                            <span className="text-zinc-300">
                              {provider.privacy}
                            </span>
                          </span>
                        </div>
                      </div>
                      {isSelected && (
                        <div className="text-[#39ff14] text-lg flex-shrink-0">
                          ✓
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg bg-[#0c1517] p-3 border border-white/10">
              <div className="flex items-center gap-2">
                {(() => {
                  const Icon = LLM_PROVIDERS[selectedLlmProvider]?.icon || Zap;
                  return <Icon size={16} className="text-[#65ff45]" />;
                })()}
                <span className="text-sm font-medium text-white">
                  {LLM_PROVIDERS[selectedLlmProvider]?.name ||
                    "Local (Qwen 3.5)"}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-2">
                {LLM_PROVIDERS[selectedLlmProvider]?.description}
              </p>
            </div>
          )}
        </article>

        <article className="neon-card rounded-[18px] bg-[#111d20]/95 p-5">
          <div className="flex items-center gap-2 text-[#65ff45]">
            <Sparkles size={17} />
            <h2 className="font-semibold">How it works</h2>
          </div>
          <p className="mt-4 text-sm leading-6 text-zinc-300">
            Your question is matched against processed study material before the
            Tutor responds.
          </p>
        </article>
        <article className="neon-card rounded-[18px] bg-[#111d20]/95 p-5">
          <h2 className="font-semibold">Best results</h2>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-zinc-300">
            <li>• Upload a text-based PDF first.</li>
            <li>• Wait until its status is completed.</li>
            <li>• Ask a specific question from the document.</li>
          </ul>
        </article>

        {/* Provider comparison */}
        <article className="neon-card rounded-[18px] bg-[#111d20]/95 p-5 text-xs">
          <h2 className="font-semibold mb-3">Provider Comparison</h2>
          <div className="space-y-2 text-zinc-300">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded bg-[#0c1517] p-2">
                <div className="font-semibold text-[#65ff45]">Local</div>
                <div className="text-zinc-400 mt-1">
                  ⚡ No API calls
                  <br />
                  🔒 Private
                  <br />
                  📦 Self-contained
                </div>
              </div>
              <div className="rounded bg-[#0c1517] p-2">
                <div className="font-semibold text-purple-300">Cloud</div>
                <div className="text-zinc-400 mt-1">
                  🚀 Advanced models
                  <br />
                  🔐 Encrypted
                  <br />
                  ⚙️ High accuracy
                </div>
              </div>
            </div>
          </div>
        </article>
      </aside>
    </section>
  );
}
