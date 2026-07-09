import { useState } from "react";
import UploadForm from "../../components/forms/UploadForm";

function UploadPDF() {
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
          Upload PDF
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-slate-950">
          Turn documents into study materials
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Upload a lecture file and quickly build summaries, notes, and quiz
          prompts.
        </p>
      </div>

      <UploadForm />
      <button
        onClick={() => setSubmitted((value) => !value)}
        className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
      >
        {submitted ? "Processing complete" : "Simulate processing"}
      </button>
    </div>
  );
}

export default UploadPDF;
