function PDFViewer({ fileName = "document.pdf" }) {
  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
        Preview
      </p>
      <div className="mt-4 flex min-h-[280px] items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
        {fileName}
      </div>
    </div>
  );
}

export default PDFViewer;
