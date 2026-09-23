import { useEffect, useRef, useState } from "react";
import { Check, FileText, Image, Info, LockKeyhole, Paperclip, Sparkles, Trash2, UploadCloud, X } from "lucide-react";
import api from "../api/axios";

const MAX_SIZE = 20 * 1024 * 1024;
const ACTIVE_GENERATION_KEY = "studygenie.activeGeneration";

const defaults = {
  raw_context: { goal: "Concept Learning", outputTypes: [] },
  question_source: { goal: "Exam Preparation", outputTypes: ["Important Questions"] },
};

const stages = [
  "Reading PDF",
  "Extracting pages",
  "Detecting questions",
  "Cleaning OCR noise",
  "Validating questions",
  "Generating answers",
];

function UploadStep({ step, title, description, role, file, inputRef, progress, uploading, dragging, status, onChoose, onUpload, onRemove, onRetry, onDrag }) {
  const [preview, setPreview] = useState("");

  useEffect(() => {
    if (!file || !(file instanceof Blob)) {
      setPreview("");
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const statusStage = status?.stage || "Reading PDF";
  const stageIndex = Math.max(0, stages.findIndex((item) => statusStage.toLowerCase().includes(item.toLowerCase().split(" ")[0])));

  return (
    <article className="rounded-[18px] border border-[#39ff14]/35 bg-[#0d1a12]/80 p-5 shadow-[0_0_35px_rgba(57,255,20,.06)] sm:p-7">
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#28b52e] text-lg font-bold text-white shadow-[0_0_22px_rgba(57,255,20,.25)]">{step}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-white">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{description}</p>
        </div>
      </div>

      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(event) => { onChoose(event.target.files?.[0]); event.target.value = ""; }} />

      {!file ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => onDrag(event, true)}
          onDragOver={(event) => { event.preventDefault(); onDrag(event, true); }}
          onDragLeave={(event) => onDrag(event, false)}
          onDrop={(event) => { event.preventDefault(); onDrag(event, false); onChoose(event.dataTransfer.files?.[0]); }}
          className={`mt-6 flex min-h-36 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-4 py-7 text-sm font-semibold transition ${dragging ? "border-[#39ff14] bg-[#39ff14]/10 text-white" : "border-[#39ff14]/35 bg-black/15 text-[#b8ffad] hover:border-[#39ff14] hover:bg-[#39ff14]/[.06]"}`}
        >
          <UploadCloud size={28} />
          <span>{dragging ? "Drop PDF here" : "Drag and drop a PDF or choose a file"}</span>
          <span className="text-xs font-normal text-zinc-500">PDF only, maximum 20 MB</span>
        </button>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-[150px_1fr]">
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
            {preview ? <object data={`${preview}#page=1`} type="application/pdf" aria-label={`${file.name} preview`} className="h-40 w-full" /> : <div className="grid h-40 place-items-center"><FileText size={34} className="text-[#65ff45]" /></div>}
          </div>
          <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#39ff14]/15 text-[#65ff45]"><FileText size={21} /></span>
              <div className="min-w-0 flex-1"><p className="truncate font-semibold text-white">{file.name}</p><p className="mt-1 text-xs text-zinc-500">{file.restored ? "Previously uploaded · generation continues on the server" : `${(file.size / 1024 / 1024).toFixed(2)} MB`}</p></div>
              <button type="button" onClick={onRemove} disabled={uploading} aria-label="Remove PDF" className="rounded-lg p-2 text-zinc-500 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"><Trash2 size={17} /></button>
            </div>
            <p className="mt-4 flex items-center gap-2 text-sm text-[#65ff45]"><Check size={16} />{progress === 100 ? "PDF processed successfully" : uploading ? "Uploading and processing PDF..." : "Ready to upload"}</p>
            {progress > 0 && <><div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#39ff14] transition-all" style={{ width: `${progress}%` }} /></div><div className="mt-2 flex justify-between text-xs text-zinc-400"><span>{progress === 100 ? "Processing complete" : progress < 40 ? "Uploading PDF..." : "Processing PDF..."}</span><span>{progress}%</span></div></>}
            {progress === 0 && <button type="button" onClick={onUpload} disabled={uploading} className="mt-4 w-full rounded-xl bg-[#39ff14] px-4 py-3 text-sm font-bold text-[#071006] disabled:bg-zinc-700 disabled:text-zinc-500">{uploading ? "Processing..." : role === "raw_context" ? "Upload Study Material PDF" : "Upload Question Paper PDF"}</button>}
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400"><span className="flex items-center gap-2 text-[#65ff45]"><LockKeyhole size={14} />Private to your account</span><span>Structured PDF processing enabled</span></div>

      {status && (
        <div className={`mt-5 rounded-xl border p-4 text-left text-sm ${status.status === "failed" ? "border-red-400/30 bg-red-500/10 text-red-200" : status.status === "completed" ? "border-[#39ff14]/30 bg-[#39ff14]/10 text-[#b8ffad]" : "border-amber-300/25 bg-amber-300/10 text-amber-100"}`}>
          <p className="font-semibold">{status.status === "failed" ? "PDF processing failed" : status.status === "completed" ? "PDF processing complete" : "Processing your PDF..."}</p>
          {status.status !== "failed" && <div className="mt-3 grid gap-2 sm:grid-cols-2">{stages.map((item, index) => { const complete = status.status === "completed" || index < stageIndex; const active = status.status !== "completed" && index === stageIndex; return <span key={item} className={`flex items-center gap-2 text-xs ${complete ? "text-[#65ff45]" : active ? "text-amber-100" : "text-zinc-500"}`}><span>{complete ? "✓" : active ? "◌" : "○"}</span>{item}</span>; })}</div>}
          {status.questionExtraction?.questionCount > 0 && <p className="mt-3 text-xs">Detected {status.questionExtraction.questionCount} valid question(s).</p>}
          {status.status === "completed" && <p className="mt-3 text-xs">{status.pages} pages · {status.characters} characters · {status.chunks} chunks · {status.embeddings} embeddings · {status.vectorsStored} vectors</p>}
          {status.status === "failed" && <><p className="mt-2">{status.error?.message || "We could not read this PDF. Try a clearer text-based scan."}</p>{onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-red-300/30 px-3 py-2 text-xs font-semibold">Retry processing</button>}</>}
          {status.status === "completed" && <p className="mt-2 text-xs text-zinc-400">OCR: {status.ocrStatus === "used" || status.ocrStatus === "partial_used" ? "text read from scanned pages" : status.ocrStatus === "not_recorded" ? "not yet run for this earlier upload" : "not needed"}</p>}
          {status.status === "completed" && onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-[#65ff45]/35 px-3 py-2 text-xs font-semibold text-[#65ff45]">Reprocess with OCR</button>}
        </div>
      )}
    </article>
  );
}

function ImageAttachment({ file, index, onRemove }) {
  const [preview, setPreview] = useState("");
  useEffect(() => { const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
  return <div className="relative h-16 w-16 overflow-hidden rounded-xl border border-white/10 bg-black/30"><img src={preview} alt="Question attachment preview" className="h-full w-full object-cover" /><button type="button" onClick={() => onRemove(index)} aria-label={`Remove image ${index + 1}`} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white hover:bg-red-500"><X size={12} /></button></div>;
}

function QuestionsInput({ text, onTextChange, pdf, onPdf, onRemovePdf, images, onImages, onRemoveImage, pdfInputRef, imageInputRef }) {
  return <article className="rounded-[18px] border border-[#39ff14]/35 bg-[#0d1a12]/80 p-5 shadow-[0_0_35px_rgba(57,255,20,.06)] sm:p-7"><div className="flex items-start gap-4"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#28b52e] text-lg font-bold text-white">2</span><div><h2 className="text-xl font-bold text-white">Questions <span className="text-sm font-normal text-zinc-500">(Optional)</span></h2><p className="mt-2 text-sm leading-6 text-zinc-300">Add questions using text, PDF, or images. StudyGenie extracts, validates, and answers only meaningful questions.</p></div></div><textarea value={text} onChange={(event) => onTextChange(event.target.value)} placeholder="Type or paste your questions here..." rows={5} className="mt-6 w-full resize-y rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-sm leading-6 text-white outline-none placeholder:text-zinc-600 focus:border-[#39ff14]/60" /><input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(event) => { onPdf(event.target.files?.[0]); event.target.value = ""; }} /><input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple className="hidden" onChange={(event) => { onImages([...event.target.files]); event.target.value = ""; }} /><div className="mt-4 flex flex-wrap items-center gap-2"><button type="button" onClick={() => pdfInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-[#39ff14]/50 hover:text-[#65ff45]"><Paperclip size={15} />PDF</button><button type="button" onClick={() => imageInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-[#39ff14]/50 hover:text-[#65ff45]"><Image size={15} />Images</button><span className="text-xs text-zinc-600">PDF · PNG · JPG · JPEG · WEBP</span></div>{(pdf || images.length > 0) && <div className="mt-4 flex flex-wrap gap-3">{pdf && <div className="flex max-w-full items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-zinc-300"><FileText size={16} className="shrink-0 text-[#65ff45]" /><span className="max-w-52 truncate">{pdf.name}</span><button type="button" onClick={onRemovePdf} aria-label="Remove question PDF" className="text-zinc-500 hover:text-red-300"><X size={15} /></button></div>}{images.map((file, index) => <ImageAttachment key={`${file.name}-${index}`} file={file} index={index} onRemove={onRemoveImage} />)}</div>}<p className="mt-4 text-xs text-zinc-500">Questions are optional. Without a question input, StudyGenie can generate useful questions from the study material.</p></article>;
}

export default function UploadPDF() {
  const rawInput = useRef(null);
  const questionInput = useRef(null);
  const [files, setFiles] = useState({ raw_context: null, question_source: null });
  const [progress, setProgress] = useState({ raw_context: 0, question_source: 0 });
  const [pdfIds, setPdfIds] = useState({ raw_context: "", question_source: "" });
  const [dragging, setDragging] = useState("");
  const [uploading, setUploading] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationType, setGenerationType] = useState("qa");
  // A request is a maximum target; the generator may safely return fewer when
  // the uploaded material cannot support additional distinct Q&A pairs.
  const [questionCount, setQuestionCount] = useState(10);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState(null);
  const [processingStatus, setProcessingStatus] = useState({ raw_context: null, question_source: null });
  const [questionText, setQuestionText] = useState("");
  const [questionImages, setQuestionImages] = useState([]);
  const questionPdfInput = useRef(null);
  const questionImageInput = useRef(null);

  // A generation job lives on the backend, not in this component. Persist its
  // ID so a browser refresh resumes status polling instead of looking like the
  // server cancelled the work.
  useEffect(() => {
    let cancelled = false;
    let timer;
    let active;

    try {
      active = JSON.parse(localStorage.getItem(ACTIVE_GENERATION_KEY) || "null");
    } catch {
      localStorage.removeItem(ACTIVE_GENERATION_KEY);
      return undefined;
    }

    if (!active?.noteId) return undefined;

    // Discard legacy or abandoned jobs. Older builds did not persist a
    // timestamp, which could leave the button stuck in "Generating..."
    // indefinitely after a failed/restarted backend.
    const startedAt = Number(active.startedAt || 0);
    if (!startedAt || Date.now() - startedAt > 10 * 60 * 1000) {
      localStorage.removeItem(ACTIVE_GENERATION_KEY);
      return undefined;
    }

    // A browser cannot recreate the original File object after a refresh, but
    // the PDF is already safely stored on the backend. Keep a small display
    // record so the upload card does not misleadingly turn empty mid-job.
    if (active.rawPdfId) {
      setPdfIds((current) => ({ ...current, raw_context: active.rawPdfId }));
      setFiles((current) => current.raw_context ? current : ({
        ...current,
        raw_context: {
          name: active.rawPdfName || "Previously uploaded study material.pdf",
          size: active.rawPdfSize || 0,
          restored: true,
        },
      }));
      setProgress((current) => ({ ...current, raw_context: 100 }));
      setProcessingStatus((current) => ({
        ...current,
        raw_context: { status: "completed", stage: "Generation in progress" },
      }));
    }

    const resume = async () => {
      try {
        const { data } = await api.get(`/notes/${active.noteId}/status`);
        if (cancelled) return;

        if (data.status === "completed") {
          localStorage.removeItem(ACTIVE_GENERATION_KEY);
          setGenerated(data);
          setGenerating(false);
          setNotice("Your generated PDF is ready. Open My Notes to download it.");
          return;
        }

        if (data.status === "failed") {
          localStorage.removeItem(ACTIVE_GENERATION_KEY);
          setGenerating(false);
          setError(data.error?.message || "AI generation failed.");
          return;
        }

        setGenerating(true);
        const progressInfo = data.processing;
        setNotice(
          progressInfo?.total
            ? `Generation resumed: ${progressInfo.completed || 0} of ${progressInfo.total} complete (${progressInfo.percent || 0}%).`
            : "Generation resumed. It will continue even if you refresh this page.",
        );
        timer = window.setTimeout(resume, 1000);
      } catch (requestError) {
        if (!cancelled) {
          // A stale localStorage job (or a deleted backend job) must not leave
          // the Generate button permanently disabled on every page load.
          if (requestError.response?.status === 404) {
            localStorage.removeItem(ACTIVE_GENERATION_KEY);
            setGenerating(false);
            setError("The previous generation job is no longer available. You can start a new one.");
          } else {
            localStorage.removeItem(ACTIVE_GENERATION_KEY);
            setGenerating(false);
            setNotice("Could not reconnect to the previous generation job. You can start a new one.");
          }
        }
      }
    };

    resume();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const choose = (role, file) => {
    const isPdf = file && (file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf"));
    if (!isPdf || file.size > MAX_SIZE) { setError("Please choose a readable PDF file smaller than 20 MB."); return; }
    setFiles((current) => ({ ...current, [role]: file }));
    setProgress((current) => ({ ...current, [role]: 0 }));
    setProcessingStatus((current) => ({ ...current, [role]: null }));
    setError("");
    setNotice("");
  };

  const remove = (role) => { setFiles((current) => ({ ...current, [role]: null })); setPdfIds((current) => ({ ...current, [role]: "" })); setProgress((current) => ({ ...current, [role]: 0 })); setProcessingStatus((current) => ({ ...current, [role]: null })); };
  const chooseQuestionPdf = (file) => { const isPdf = file && (file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf")); if (!isPdf || file.size > MAX_SIZE) { setError("Please choose a question PDF smaller than 20 MB."); return; } setFiles((current) => ({ ...current, question_source: file })); setPdfIds((current) => ({ ...current, question_source: "" })); setError(""); };
  const chooseQuestionImages = (selected) => { const valid = selected.filter((file) => ["image/png", "image/jpeg", "image/webp"].includes(file.type) && file.size > 0 && file.size <= 10 * 1024 * 1024); if (valid.length !== selected.length) setError("Only PNG, JPG, JPEG, or WEBP images up to 10 MB are supported."); setQuestionImages((current) => [...current, ...valid.filter((file) => !current.some((item) => item.name === file.name && item.size === file.size))].slice(0, 10)); };
  const waitForProcessing = async (role, pdfId) => {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const { data } = await api.get(`/pdf/${pdfId}/processing`);
      setProcessingStatus((current) => ({ ...current, [role]: data }));
      if (data.status === "completed") { setProgress((current) => ({ ...current, [role]: 100 })); return data; }
      if (data.status === "failed") { const failure = new Error(data.error?.message || "PDF processing failed."); failure.processing = data.error; throw failure; }
      setProgress((current) => ({ ...current, [role]: Math.max(current[role], 55) }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("PDF processing is taking longer than expected. You can retry it without uploading again.");
  };

  const upload = async (role) => {
    const file = files[role]; if (!file) return;
    if (!(file instanceof Blob)) return pdfIds[role] || null;
    setUploading(role); setError(""); setProgress((current) => ({ ...current, [role]: 5 }));
    try {
      const form = new FormData(); form.append("pdf", file);
      const { data } = await api.post("/pdf/upload", form, { onUploadProgress: (event) => { if (event.total) setProgress((current) => ({ ...current, [role]: Math.max(5, Math.min(35, Math.round((event.loaded / event.total) * 35)) ) })); } });
      const pdfId = data.pdfId || data.pdf?._id;
      setPdfIds((current) => ({ ...current, [role]: pdfId })); setProgress((current) => ({ ...current, [role]: 40 }));
      const setup = defaults[role];
      if (data.pdf?.status !== "processing" && data.pdf?.status !== "completed") await api.post(`/pdf/${pdfId}/setup`, { goal: setup.goal, level: "Intermediate", explanationStyle: "Like a Teacher", outputLanguage: "English", studyTime: "1 Hour", focusAreas: ["Everything"], outputTypes: setup.outputTypes, aiPersonality: "Friendly Teacher", documentRole: role });
      setProcessingStatus((current) => ({ ...current, [role]: { status: "processing", stage: "Reading PDF" } }));
      await waitForProcessing(role, pdfId);
      setNotice(`${role === "raw_context" ? "Study material" : "Question source"} PDF is ready.`);
      return pdfId;
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "PDF upload failed.");
      if (!requestError.response?.data?.pdf) setProgress((current) => ({ ...current, [role]: 0 }));
      return null;
    } finally { setUploading(""); }
  };

  const retryProcessing = async (role) => { const pdfId = pdfIds[role]; if (!pdfId) return; setUploading(role); setError(""); try { const setup = defaults[role]; await api.post(`/pdf/${pdfId}/setup`, { goal: setup.goal, level: "Intermediate", explanationStyle: "Like a Teacher", outputLanguage: "English", studyTime: "1 Hour", focusAreas: ["Everything"], outputTypes: setup.outputTypes, aiPersonality: "Friendly Teacher", documentRole: role }); await waitForProcessing(role, pdfId); } catch (requestError) { setError(requestError.response?.data?.message || requestError.message || "PDF processing failed."); } finally { setUploading(""); } };

  const waitForGeneration = async (noteId) => { for (let attempt = 0; attempt < 300; attempt += 1) { const { data } = await api.get(`/notes/${noteId}/status`); if (data.status === "completed") { localStorage.removeItem(ACTIVE_GENERATION_KEY); return data; } if (data.status === "failed") { localStorage.removeItem(ACTIVE_GENERATION_KEY); throw new Error(data.error?.message || "AI generation failed."); } if (data.processing?.total) setNotice(`Generating detailed answers: ${data.processing.completed || 0} of ${data.processing.total} complete (${data.processing.percent || 0}%).`); await new Promise((resolve) => setTimeout(resolve, 1000)); } throw new Error("Generation is taking longer than 5 minutes. It will continue in the background; open My Notes later to download it."); };
  const generate = async () => { if (!pdfIds.raw_context) return; setGenerating(true); setError(""); setNotice(""); try { let questionPdfId = pdfIds.question_source; if (files.question_source && !questionPdfId) questionPdfId = await upload("question_source"); if (files.question_source && !questionPdfId) return; const form = new FormData(); form.append("rawPdfId", pdfIds.raw_context); if (questionPdfId) form.append("questionPdfId", questionPdfId); form.append("questionText", questionText); form.append("generationType", generationType); if (generationType === "qa") form.append("count", String(questionCount)); questionImages.forEach((file) => form.append("questionImages", file)); const { data } = await api.post("/notes/generate-pdf", form); localStorage.setItem(ACTIVE_GENERATION_KEY, JSON.stringify({ noteId: data.noteId, generationType, startedAt: Date.now(), rawPdfId: pdfIds.raw_context, rawPdfName: files.raw_context?.name, rawPdfSize: files.raw_context?.size })); setNotice("Generation started. It will continue if you refresh this page."); const completed = await waitForGeneration(data.noteId); setGenerated(completed); const file = await api.get(`/notes/${data.noteId}/download`, { responseType: "blob" }); const url = URL.createObjectURL(file.data); const link = document.createElement("a"); link.href = url; link.download = `studygenie-${generationType}.pdf`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); setNotice("Your StudyGenie PDF is ready and downloaded."); } catch (requestError) { setError(requestError.response?.data?.message || requestError.message || "Study material generation failed."); } finally { setGenerating(false); } };

  const ready = progress.raw_context === 100;
  const selectedLabel = generationType === "notes" ? "Study Notes" : generationType === "quiz" ? "Quiz" : "Question & Answers";
  return <section className="mx-auto max-w-5xl space-y-6 pb-10"><header className="flex items-start gap-4"><span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-[#39ff14]/15 text-[#65ff45]"><FileText size={30} /></span><div><h1 className="text-3xl font-bold text-white">Upload &amp; Generate Study Material</h1><p className="mt-2 text-base text-zinc-300">Upload a structured PDF, validate its content, and create grounded study material.</p></div></header>
    <UploadStep step="1" title="Study Material PDF" description="Upload lecture notes or a textbook PDF. It becomes the grounded source for notes, answers, and RAG retrieval." role="raw_context" file={files.raw_context} inputRef={rawInput} progress={progress.raw_context} uploading={uploading === "raw_context"} dragging={dragging === "raw_context"} status={processingStatus.raw_context} onChoose={(file) => choose("raw_context", file)} onUpload={() => upload("raw_context")} onRemove={() => remove("raw_context")} onRetry={() => retryProcessing("raw_context")} onDrag={(_, active) => setDragging(active ? "raw_context" : "")} />
    <QuestionsInput text={questionText} onTextChange={setQuestionText} pdf={files.question_source} onPdf={chooseQuestionPdf} onRemovePdf={() => remove("question_source")} images={questionImages} onImages={chooseQuestionImages} onRemoveImage={(index) => setQuestionImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} pdfInputRef={questionPdfInput} imageInputRef={questionImageInput} />
    {error && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}{notice && <p role="status" className="rounded-xl border border-[#39ff14]/30 bg-[#39ff14]/10 p-4 text-sm text-[#b8ffad]">{notice}</p>}
    <article className="rounded-[18px] border border-white/10 bg-black/20 p-5"><h2 className="font-semibold text-white">Generation type</h2><div className="mt-4 grid gap-3 sm:grid-cols-3">{[["notes", "Study Notes", "Structured explanations and revision material."], ["qa", "Question & Answers", "Descriptive answers without MCQ options."], ["quiz", "Quiz", "Separate multiple-choice assessment."]].map(([value, label, description]) => <button key={value} type="button" onClick={() => setGenerationType(value)} className={`rounded-xl border p-4 text-left transition ${generationType === value ? "border-[#39ff14] bg-[#39ff14]/10" : "border-white/10 bg-white/[.02] hover:border-white/25"}`}><p className="font-semibold text-white">{label}</p><p className="mt-2 text-xs leading-5 text-zinc-400">{description}</p></button>)}</div></article>
    {generationType === "qa" && <article className="rounded-[18px] border border-white/10 bg-black/20 p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold text-white">Number of questions</h2><p className="mt-1 text-xs leading-5 text-zinc-400">Each is a source-grounded descriptive question with a full answer. Choose up to 60; fewer may be returned when the material does not support more distinct answers.</p></div><input type="number" min={1} max={60} value={questionCount} onChange={(event) => { const next = Number.parseInt(event.target.value, 10); setQuestionCount(Number.isFinite(next) ? Math.min(60, Math.max(1, next)) : 10); }} className="w-24 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-center text-lg font-bold text-white outline-none focus:border-[#39ff14]/60" /></div></article>}
    <article className="rounded-[18px] border border-[#39ff14]/45 bg-[#0d1a12]/80 p-6 text-center shadow-[0_0_35px_rgba(57,255,20,.08)]"><div className="mx-auto max-w-2xl"><div className="flex items-center justify-center gap-3 text-left"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#28b52e] text-white"><Info size={22} /></span><div><h2 className="text-lg font-semibold text-white">Ready to generate {selectedLabel}</h2><p className="mt-1 text-sm text-zinc-300">Content is based on your uploaded PDF and validated processing results.</p></div></div><button type="button" onClick={generate} disabled={!ready || generating} className="mt-7 inline-flex min-w-[280px] items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-[#39d52c] to-[#20a923] px-8 py-4 text-lg font-bold text-white shadow-[0_0_25px_rgba(57,255,20,.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"><Sparkles size={22} />{generating ? "Generating..." : `Generate ${selectedLabel}`}</button><p className="mt-4 text-xs text-[#65ff45]">Private · Source-grounded · PDF ready</p></div></article>
    {generated && <article className="rounded-[18px] border border-white/15 bg-black/25 p-6 text-left"><h2 className="text-xl font-bold text-white">Generated {selectedLabel}</h2>{generated.questions?.length > 0 && <div className="mt-5 space-y-4">{generated.questions.map((item, index) => <div key={`${item.question_number || index}`} className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="font-semibold text-white">Question {index + 1}</p><p className="mt-2 text-sm leading-6 text-zinc-200">{item.question}</p>{item.options?.length > 0 && <ol className="mt-2 list-[upper-alpha] space-y-1 pl-5 text-sm text-zinc-300">{item.options.map((option) => <li key={option}>{option}</li>)}</ol>}<p className="mt-2 text-sm text-[#b8ffad]"><b>Answer:</b> {item.answer}</p>{item.source_pages?.length > 0 && <p className="mt-1 text-xs text-zinc-500">Source page(s): {item.source_pages.join(", ")}</p>}</div>)}</div>}</article>}
  </section>;
}
