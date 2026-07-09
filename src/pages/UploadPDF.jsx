import { useRef, useState } from "react";
import {
  CloudUpload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ArrowRight,
} from "lucide-react";

function UploadPDF() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef(null);

  const fileSize = file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "";

  const updateFile = (selectedFile) => {
    if (!selectedFile) return;
    if (selectedFile.type !== "application/pdf") {
      setError("Please upload a PDF file only.");
      return;
    }

    setError("");
    setFile(selectedFile);
    setStatus("ready");
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    const droppedFile = event.dataTransfer.files?.[0];
    updateFile(droppedFile);
  };

  const handleUpload = () => {
    if (!file) {
      setError("Select a PDF file before uploading.");
      return;
    }

    setStatus("uploading");
    setError("");
    setProgress(0);

    const interval = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          window.clearInterval(interval);
          setStatus("success");
          return 100;
        }
        return prev + 14;
      });
    }, 120);
  };

  const clearFile = () => {
    setFile(null);
    setStatus("idle");
    setProgress(0);
    setError("");
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-10">
      <div className="rounded-[32px] bg-gradient-to-r from-brand-600 to-indigo-600 p-8 text-white shadow-soft">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-brand-100/80">
              PDF workflow
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
              Upload your study materials with confidence.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-white/85 sm:text-lg">
              The upload experience is optimized for clarity, speed, and progress tracking.
            </p>
          </div>
          <div className="rounded-[28px] bg-white/10 px-5 py-4 text-sm text-white shadow-card">
            <p className="font-semibold">Upload status</p>
            <p className="mt-2 text-slate-100/80">Drag, drop, preview and upload seamlessly.</p>
          </div>
        </div>
      </div>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[32px] bg-white p-8 shadow-soft">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.32em] text-slate-500">
                Document upload
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-slate-950">
                Select or drop your PDF
              </h2>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
              <CloudUpload size={18} />
              .pdf only
            </div>
          </div>

          <div
            className={`mt-8 rounded-[28px] border-2 border-dashed p-8 transition ${
              dragActive
                ? 'border-brand-500 bg-brand-50/40'
                : 'border-slate-200 bg-slate-50'
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDrop={handleDrop}
          >
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-brand-50 text-brand-700 shadow-soft">
                <FileText size={28} />
              </div>
              <div>
                <p className="text-xl font-semibold text-slate-950">
                  Drag & drop your PDF here
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  Or select a file from your computer.
                </p>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(event) => updateFile(event.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-brand-700"
              >
                Browse files
                <ArrowRight size={16} />
              </button>
            </div>
          </div>

          <div className="mt-8 space-y-4">
            <div className="rounded-[28px] bg-slate-50 p-5 text-sm text-slate-600 shadow-card">
              <p className="font-semibold text-slate-900">Upload guidelines</p>
              <ul className="mt-3 space-y-2 text-slate-500">
                <li>• Select a PDF file under 20MB.</li>
                <li>• Preview your file before generating notes.</li>
                <li>• Upload progress is visible in real time.</li>
              </ul>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-[28px] bg-white p-4 shadow-card">
                <p className="text-sm uppercase tracking-[0.28em] text-slate-500">
                  Workflows
                </p>
                <p className="mt-3 text-2xl font-semibold text-slate-950">AI summary</p>
              </div>
              <div className="rounded-[28px] bg-white p-4 shadow-card">
                <p className="text-sm uppercase tracking-[0.28em] text-slate-500">
                  Notes
                </p>
                <p className="mt-3 text-2xl font-semibold text-slate-950">Smart highlights</p>
              </div>
              <div className="rounded-[28px] bg-white p-4 shadow-card">
                <p className="text-sm uppercase tracking-[0.28em] text-slate-500">
                  Quizzes
                </p>
                <p className="mt-3 text-2xl font-semibold text-slate-950">Practice fast</p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[32px] bg-white p-8 shadow-soft">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.32em] text-slate-500">
                  Preview & status
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-slate-950">
                  File details
                </h2>
              </div>
              <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
                {status === 'success' ? 'Ready' : status === 'uploading' ? 'Uploading' : 'Awaiting'}
              </span>
            </div>

            <div className="mt-6 rounded-[28px] bg-slate-50 p-6 shadow-card">
              {status === 'idle' && !file ? (
                <div className="text-center text-slate-500">
                  <p className="text-sm font-semibold text-slate-900">No file selected yet.</p>
                  <p className="mt-2 text-sm">Choose a PDF to see the preview and upload progress.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm uppercase tracking-[0.28em] text-slate-500">
                        File name
                      </p>
                      <p className="mt-2 text-lg font-semibold text-slate-950">
                        {file?.name}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={clearFile}
                      className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                    >
                      <Trash2 size={16} />
                      Remove
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[24px] bg-white p-4 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.28em] text-slate-500">File size</p>
                      <p className="mt-2 text-sm font-semibold text-slate-950">{fileSize}</p>
                    </div>
                    <div className="rounded-[24px] bg-white p-4 shadow-sm">
                      <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Type</p>
                      <p className="mt-2 text-sm font-semibold text-slate-950">PDF document</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4 text-sm font-semibold text-slate-700">
                      <span>Upload progress</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-brand-600 transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-[24px] bg-rose-50 p-4 text-sm text-rose-700 shadow-sm">
                <div className="flex items-center gap-3">
                  <AlertCircle size={18} />
                  <span>{error}</span>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleUpload}
                className="inline-flex items-center justify-center rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={status === 'uploading' || !file}
              >
                {status === 'uploading' ? 'Uploading...' : 'Upload PDF'}
              </button>
              {status === 'success' && (
                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 shadow-sm">
                  <CheckCircle2 size={16} />
                  Upload complete
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default UploadPDF;
