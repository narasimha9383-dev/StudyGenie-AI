function ExtractedNotes({ notes = [] }) {
  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
        Extracted notes
      </p>
      <div className="mt-4 space-y-3">
        {notes.length === 0 ? (
          <p className="text-sm text-slate-500">
            Upload a PDF to generate structured notes.
          </p>
        ) : (
          notes.map((note, index) => (
            <div
              key={`${note}-${index}`}
              className="rounded-[20px] bg-slate-50 p-4 text-sm leading-6 text-slate-700"
            >
              {note}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ExtractedNotes;
