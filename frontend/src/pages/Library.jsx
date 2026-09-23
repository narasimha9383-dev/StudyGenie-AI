import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Download,
  FileText,
  FolderOpen,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import api from "../api/axios";

const MAX_SIZE = 20 * 1024 * 1024;
const filters = ["all", "pdf", "notes", "question banks", "flashcards", "study guides"];
const sortOptions = ["recent", "updated", "name-asc", "name-desc", "largest"];

const formatDate = (date) => date ? new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
const formatSize = (bytes) => {
  if (!bytes) return "Size unavailable";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
const statusLabel = (status) => ({ awaiting_setup: "Not processed", processing: "Processing", completed: "Ready for AI", failed: "Failed" }[status] || "Uploaded");

function TypeIcon({ type }) {
  return <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${type === "pdf" ? "bg-red-400/10 text-red-300" : "bg-[#39ff14]/10 text-[#65ff45]"}`}><FileText size={21} /></span>;
}

function StatusBadge({ status }) {
  const ready = status === "completed";
  const failed = status === "failed";
  return <span className={`rounded-full px-2.5 py-1 text-[11px] ${ready ? "bg-[#39ff14]/10 text-[#65ff45]" : failed ? "bg-red-400/10 text-red-200" : "bg-amber-300/10 text-amber-100"}`}>{ready ? "✓ " : ""}{statusLabel(status)}</span>;
}

function UploadModal({ onClose, onUploaded }) {
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const choose = (selected) => {
    if (!selected) return;
    if (selected.type !== "application/pdf" || selected.size > MAX_SIZE) {
      setError("The current upload pipeline accepts PDF files up to 20 MB.");
      return;
    }
    setError("");
    setFile(selected);
  };
  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("pdf", file);
      const { data } = await api.post("/pdf/upload", form);
      const pdfId = data.pdfId || data.pdf?._id;
      await api.post(`/pdf/${pdfId}/setup`, { goal: "Concept Learning", level: "Intermediate", explanationStyle: "Like a Teacher", outputLanguage: "English", studyTime: "1 Hour", focusAreas: ["Everything"], outputTypes: [], aiPersonality: "Friendly Teacher", documentRole: "raw_context" });
      onUploaded();
      onClose();
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm"><div role="dialog" aria-modal="true" aria-labelledby="upload-title" className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d1110] p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 id="upload-title" className="text-xl font-semibold text-white">Upload Material</h2><p className="mt-1 text-sm text-zinc-400">Add a PDF to your private AI study library.</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white" aria-label="Close upload dialog"><X size={19} /></button></div><input ref={input} type="file" accept="application/pdf" className="hidden" onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ""; }} /><button type="button" onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer.files?.[0]); }} className="mt-6 flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-[#39ff14]/40 bg-[#39ff14]/[.04] px-5 py-10 text-center hover:bg-[#39ff14]/[.08]"><UploadCloud size={32} className="text-[#65ff45]" /><span className="mt-3 font-semibold text-white">Drag &amp; drop your study material here</span><span className="mt-1 text-sm text-zinc-500">or Browse Files · PDF up to 20 MB</span></button>{file && <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[.03] p-3"><FileText className="text-[#65ff45]" size={20} /><span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{file.name}</span><span className="text-xs text-zinc-500">{formatSize(file.size)}</span></div>}{error && <p role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}<button type="button" onClick={upload} disabled={!file || uploading} className="mt-5 w-full rounded-xl bg-[#39ff14] px-4 py-3 text-sm font-bold text-[#071006] disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500">{uploading ? "Uploading and processing…" : "Upload Material"}</button></div></div>;
}

function MaterialCard({ item, onOpen, onDownload, onGenerate, onDelete }) {
  const isNote = item.kind === "note";
  return <article className="group flex min-h-[275px] flex-col rounded-2xl border border-white/10 bg-[#0d1110] p-5 transition hover:-translate-y-0.5 hover:border-[#39ff14]/30 hover:shadow-[0_0_28px_rgba(57,255,20,.06)]"><div className="flex items-start gap-3"><TypeIcon type={isNote ? "note" : "pdf"} /><div className="min-w-0 flex-1"><h2 className="truncate font-semibold text-white" title={item.title}>{item.title}</h2><p className="mt-1 text-xs text-zinc-500">{isNote ? "AI-generated study material" : "Uploaded study material"}</p></div><details className="relative"><summary className="list-none cursor-pointer rounded-lg p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white" aria-label={`Manage ${item.title}`}><MoreVertical size={17} /></summary><div className="absolute right-0 top-9 z-10 w-44 rounded-xl border border-white/10 bg-[#151a17] p-1 shadow-xl"><button type="button" onClick={() => onOpen(item)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-zinc-300 hover:bg-white/10">Open</button>{!isNote && <button type="button" onClick={() => onGenerate(item)} disabled={item.status !== "completed"} className="w-full rounded-lg px-3 py-2 text-left text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-40">Generate Study Material</button>}<button type="button" onClick={() => onDownload(item)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-zinc-300 hover:bg-white/10">Download</button><button type="button" onClick={() => onDelete(item)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-200 hover:bg-red-500/10">Delete</button></div></details></div><div className="mt-5 space-y-2 text-sm"><p className="text-zinc-300">{isNote ? "Study Notes · Question Bank" : "PDF"}</p><p className="text-xs text-zinc-500">{isNote ? `${item.questionCount || 0} questions · Generated ${formatDate(item.createdAt)}` : `${item.pages || 0} pages · ${formatSize(item.size)}`}</p><p className="text-xs text-zinc-500">Added {formatDate(item.createdAt)}</p></div><div className="mt-4 flex flex-wrap gap-2"><span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400">{isNote ? "AI Generated" : "PDF"}</span>{item.indexed && <span className="rounded-full border border-[#39ff14]/20 px-2.5 py-1 text-[11px] text-[#65ff45]">Indexed</span>}</div><div className="mt-auto pt-5"><div className="mb-4"><StatusBadge status={isNote ? "completed" : item.status} />{!isNote && item.status === "processing" && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full w-2/3 animate-pulse rounded-full bg-[#39ff14]" /></div>}</div><div className="flex items-center gap-2"><button type="button" onClick={() => onOpen(item)} className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-[#39ff14]/40 hover:text-[#65ff45]">Open</button><button type="button" onClick={() => isNote ? onDownload(item) : onGenerate(item)} disabled={!isNote && item.status !== "completed"} className="inline-flex items-center justify-center gap-1 rounded-xl bg-[#39ff14] px-3 py-2 text-xs font-bold text-[#071006] disabled:bg-zinc-700 disabled:text-zinc-500">{isNote ? <Download size={14} /> : <Sparkles size={14} />}{isNote ? "Download" : "Generate"}</button></div></div></article>;
}

export default function Library() {
  const [pdfs, setPdfs] = useState([]);
  const [notes, setNotes] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [notice, setNotice] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [pdfResponse, noteResponse] = await Promise.all([api.get("/pdf"), api.get("/notes")]);
      setPdfs(pdfResponse.data || []);
      setNotes((noteResponse.data.notes || []).filter((note) => note.status === "completed"));
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load your library. Please try again.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const materials = useMemo(() => {
    const pdfItems = pdfs.map((pdf) => ({ ...pdf, id: pdf._id, kind: "pdf", title: pdf.title || pdf.fileName, indexed: pdf.status === "completed" && pdf.metadata?.chromaSync?.status === "ready" }));
    const noteItems = notes.map((note) => ({ ...note, id: note._id, kind: "note", title: note.title || "StudyGenie Notes", questionCount: note.questions?.length || 0, status: "completed" }));
    const normalizedQuery = query.trim().toLowerCase();
    let result = [...pdfItems, ...noteItems].filter((item) => {
      const matchesFilter = filter === "all" || (filter === "pdf" && item.kind === "pdf") || (filter !== "pdf" && item.kind === "note" && filter === "notes") || (filter === "question banks" && item.kind === "note" && item.questionCount > 0);
      const haystack = `${item.title} ${item.fileName || ""} ${item.content || ""}`.toLowerCase();
      return matchesFilter && (!normalizedQuery || haystack.includes(normalizedQuery));
    });
    result.sort((a, b) => {
      if (sort === "name-asc") return a.title.localeCompare(b.title);
      if (sort === "name-desc") return b.title.localeCompare(a.title);
      if (sort === "largest") return (b.size || 0) - (a.size || 0);
      if (sort === "updated") return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    return result;
  }, [filter, notes, pdfs, query, sort]);

  const download = async (item) => {
    try {
      const endpoint = item.kind === "note" ? `/notes/${item.id}/download` : `/pdf/${item.id}/download`;
      const { data } = await api.get(endpoint, { responseType: "blob" });
      const url = URL.createObjectURL(data); const link = document.createElement("a"); link.href = url; link.download = `${item.title || "studygenie-material"}.pdf`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (requestError) { setError(requestError.response?.data?.message || "Could not download this material."); }
  };
  const remove = async (item) => {
    if (!window.confirm("Delete this material? This will remove the material and its associated generated resources from your library.")) return;
    try {
      await api.delete(item.kind === "note" ? `/notes/${item.id}` : `/pdf/${item.id}`);
      setPdfs((items) => item.kind === "pdf" ? items.filter((pdf) => pdf._id !== item.id) : items);
      setNotes((items) => item.kind === "note" ? items.filter((note) => note._id !== item.id) : items);
    } catch (requestError) { setError(requestError.response?.data?.message || "Could not delete this material."); }
  };
  const generate = async (item) => {
    try {
      setNotice("Study material generation started. Check Notes for the completed resource.");
      await api.post("/notes/generate-pdf", { rawPdfId: item.id });
    } catch (requestError) { setError(requestError.response?.data?.message || "Could not start generation."); }
  };

  return <section className="mx-auto max-w-7xl space-y-6 pb-10">
    <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.22em] text-[#65ff45]">Your knowledge space</p><h1 className="mt-2 flex items-center gap-3 text-3xl font-bold text-white"><FolderOpen className="text-[#65ff45]" />My Library</h1><p className="mt-2 text-sm leading-6 text-zinc-400">Organize your study materials, generated notes, questions, and resources in one place.</p></div><div className="flex flex-wrap gap-3"><button type="button" onClick={() => setUploadOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-zinc-200 hover:border-[#39ff14]/50 hover:text-[#65ff45]"><Plus size={17} />Upload Material</button><Link to="/upload" className="inline-flex items-center gap-2 rounded-xl bg-[#39ff14] px-4 py-3 text-sm font-bold text-[#071006]"><Sparkles size={17} />Generate Study Material</Link></div></header>
    {notice && <p role="status" className="rounded-xl border border-[#39ff14]/30 bg-[#39ff14]/10 p-4 text-sm text-[#b8ffad]">{notice}</p>}
    {error && <div role="alert" className="flex items-center justify-between gap-4 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200"><span>{error}</span><button type="button" onClick={load} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-red-300/30 px-3 py-2 text-xs"><RefreshCw size={14} />Retry</button></div>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-2xl border border-white/10 bg-[#0d1110] p-5"><p className="text-xs text-zinc-500">Total Materials</p><p className="mt-2 text-2xl font-semibold text-white">{pdfs.length + notes.length}</p></div><div className="rounded-2xl border border-white/10 bg-[#0d1110] p-5"><p className="text-xs text-zinc-500">Study Notes</p><p className="mt-2 text-2xl font-semibold text-white">{notes.length}</p></div><div className="rounded-2xl border border-white/10 bg-[#0d1110] p-5"><p className="text-xs text-zinc-500">Question Banks</p><p className="mt-2 text-2xl font-semibold text-white">{notes.filter((note) => note.questions?.length).length}</p></div><div className="rounded-2xl border border-white/10 bg-[#0d1110] p-5"><p className="text-xs text-zinc-500">Ready for AI</p><p className="mt-2 text-2xl font-semibold text-[#65ff45]">{pdfs.filter((pdf) => pdf.status === "completed").length}</p></div></div>
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#0d1110] p-4 lg:flex-row"><label className="flex flex-1 items-center gap-3 rounded-xl border border-white/10 bg-white/[.03] px-4 py-3 text-zinc-400 focus-within:border-[#39ff14]/50"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your library..." className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-500" /></label><div className="flex gap-2 overflow-x-auto">{filters.map((item) => <button type="button" key={item} onClick={() => setFilter(item)} className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs capitalize ${filter === item ? "bg-[#39ff14] font-semibold text-[#071006]" : "border border-white/10 text-zinc-400 hover:text-white"}`}>{item}</button>)}</div><label className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs text-zinc-400">Sort <ChevronDown size={14} /><select value={sort} onChange={(event) => setSort(event.target.value)} className="bg-transparent py-2 text-zinc-200 outline-none"><option value="recent">Recently Added</option><option value="updated">Recently Updated</option><option value="name-asc">Name A-Z</option><option value="name-desc">Name Z-A</option><option value="largest">Largest</option></select></label></div>
    {loading && <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-72 animate-pulse rounded-2xl border border-white/10 bg-white/[.04]" />)}</div>}
    {!loading && !error && !materials.length && <div className="rounded-2xl border border-white/10 bg-[#0d1110] p-12 text-center"><BookOpen className="mx-auto text-[#65ff45]" size={38} /><h2 className="mt-4 text-xl font-semibold text-white">Your Library is Empty</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">Upload your first study material and let StudyGenie AI turn it into structured exam-ready study resources.</p><button type="button" onClick={() => setUploadOpen(true)} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#39ff14] px-5 py-3 text-sm font-bold text-[#071006]"><UploadCloud size={17} />Upload Material</button></div>}
    {!loading && !error && materials.length > 0 && <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{materials.map((item) => <MaterialCard key={`${item.kind}-${item.id}`} item={item} onOpen={setViewer} onDownload={download} onGenerate={generate} onDelete={remove} />)}</div>}
    {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} onUploaded={load} />}
    {viewer && <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm"><div role="dialog" aria-modal="true" aria-labelledby="viewer-title" className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-white/10 bg-[#0d1110] shadow-2xl"><div className="flex items-center gap-3 border-b border-white/10 p-5"><TypeIcon type={viewer.kind} /><div className="min-w-0 flex-1"><h2 id="viewer-title" className="truncate font-semibold text-white">{viewer.title}</h2><p className="text-xs text-zinc-500">{viewer.kind === "note" ? "AI-generated study material" : `${viewer.pages || 0} pages · ${statusLabel(viewer.status)}`}</p></div><button type="button" onClick={() => setViewer(null)} className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white" aria-label="Close material viewer"><X size={19} /></button></div><div className="overflow-y-auto p-6">{viewer.kind === "note" ? <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-300">{viewer.content || "Generated content is available from the Notes page."}</p> : <div className="rounded-xl border border-white/10 bg-white/[.02] p-6 text-center"><FileText className="mx-auto text-[#65ff45]" size={34} /><p className="mt-3 text-sm text-zinc-300">This PDF is stored securely in your library.</p><p className="mt-1 text-xs text-zinc-500">Use Download to open it in your PDF viewer or ask AI about it from AI Tutor.</p></div>}</div><div className="flex flex-wrap justify-end gap-3 border-t border-white/10 p-5"><button type="button" onClick={() => download(viewer)} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-zinc-200 hover:border-[#39ff14]/40 hover:text-[#65ff45]"><Download size={16} />Download</button>{viewer.kind === "pdf" && <Link to="/chatbot" onClick={() => setViewer(null)} className="inline-flex items-center gap-2 rounded-xl bg-[#39ff14] px-4 py-2.5 text-sm font-bold text-[#071006]"><Sparkles size={16} />Ask AI</Link>}</div></div></div>}
  </section>;
}
