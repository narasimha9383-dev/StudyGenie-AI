import { useEffect, useState } from "react";
import { Download, FileText, History, Trash2 } from "lucide-react";
import api from "../api/axios";

export default function Notes() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/notes").then(({ data }) => {
      setNotes((data.notes || []).filter((note) => note.content && note.title));
    }).catch((requestError) => {
      setError(requestError.response?.data?.message || "Could not load note-generation history.");
    }).finally(() => setLoading(false));
  }, []);

  const remove = async (id) => {
    try {
      await api.delete(`/notes/${id}`);
      setNotes((items) => items.filter((note) => note._id !== id));
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not delete generated note.");
    }
  };

  const download = async (note) => {
    try {
      const { data } = await api.get(`/notes/${note._id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(data); const link = document.createElement("a"); link.href = url; link.download = `${note.title || "studygenie-notes"}.pdf`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (requestError) { setError(requestError.response?.data?.message || "Could not download this generated PDF."); }
  };

  return <section className="mx-auto max-w-6xl space-y-6">
    <header className="flex items-start gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#39ff14]/15 text-[#65ff45]"><History size={25} /></span><div><p className="text-xs font-semibold uppercase tracking-[.22em] text-[#65ff45]">AI-generated resources</p><h1 className="mt-2 text-3xl font-bold text-white">History of Notes Generation</h1><p className="mt-2 text-sm leading-6 text-zinc-400">Only notes created by StudyGenie are listed here. Uploaded Raw Context and Question Bank PDFs are never shown in this history.</p></div></header>
    {error && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}
    {loading && <div className="neon-card rounded-[18px] p-8 text-sm text-zinc-400">Loading AI-generated note history…</div>}
    {!loading && !notes.length && <div className="neon-card rounded-[18px] p-10 text-center"><FileText className="mx-auto text-[#65ff45]" size={30} /><h2 className="mt-4 text-lg font-semibold text-white">No generated notes yet</h2><p className="mt-2 text-sm text-zinc-400">Generate notes from the Upload PDF page to see them here.</p></div>}
    <div className="space-y-4">{notes.map((note) => <article key={note._id} className="neon-card overflow-hidden rounded-[18px]"><div className="flex items-center gap-3 border-b border-white/10 px-5 py-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#39ff14]/10 text-[#65ff45]"><FileText size={18} /></span><div className="min-w-0 flex-1"><h2 className="truncate font-semibold text-white">{note.title}</h2><p className="text-xs text-zinc-500">Generated {new Date(note.createdAt).toLocaleString()}</p></div><span className="rounded-full bg-[#39ff14]/10 px-3 py-1 text-xs text-[#65ff45]">AI generated</span>{note.pdfPath && <button type="button" onClick={() => download(note)} className="rounded-lg p-2 text-zinc-400 transition hover:bg-[#39ff14]/10 hover:text-[#65ff45]}" aria-label={`Download ${note.title}`}><Download size={17} /></button>}<button type="button" onClick={() => remove(note._id)} className="rounded-lg p-2 text-zinc-500 transition hover:bg-red-400/10 hover:text-red-300" aria-label={`Delete ${note.title}`}><Trash2 size={17} /></button></div><div className="max-h-[420px] overflow-y-auto px-6 py-5"><p className="whitespace-pre-wrap text-sm leading-7 text-zinc-300">{note.content}</p></div></article>)}</div>
  </section>;
}
