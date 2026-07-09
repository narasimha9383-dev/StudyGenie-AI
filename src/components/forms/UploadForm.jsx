import { useState } from "react";
import { UploadCloud } from "lucide-react";

function UploadForm() {
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    alert(`Uploaded ${fileName || "your file"} for ${title || "study notes"}`);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-[28px] border border-slate-200 bg-white p-6 shadow-card"
    >
      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-700">
          Title
        </label>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Lecture notes"
          className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
        />
      </div>
      <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-600">
          <UploadCloud size={20} />
        </div>
        <p className="mt-4 text-sm font-semibold text-slate-700">
          Drop a PDF here or browse
        </p>
        <input
          type="file"
          onChange={(event) => setFileName(event.target.files?.[0]?.name || "")}
          className="mt-4 w-full text-sm text-slate-500"
        />
      </div>
      <button
        type="submit"
        className="rounded-full bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-700"
      >
        Upload PDF
      </button>
    </form>
  );
}

export default UploadForm;
