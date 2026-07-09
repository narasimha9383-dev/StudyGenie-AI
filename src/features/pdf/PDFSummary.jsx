function PDFSummary({ title = "Lecture summary", summary }) {
  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
        PDF summary
      </p>
      <h3 className="mt-3 text-xl font-semibold text-slate-950">{title}</h3>
      <p className="mt-4 text-sm leading-7 text-slate-600">
        {summary ||
          "A concise summary will appear here after you upload a document."}
      </p>
    </div>
  );
}

export default PDFSummary;
