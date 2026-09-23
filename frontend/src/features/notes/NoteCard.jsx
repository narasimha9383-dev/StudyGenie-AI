const NoteCard = ({ note }) => {
  return (
    <div className="note-card">

      <div
        className="note-strip"
        style={{ background: note.color }}
      ></div>

      <h2>{note.title}</h2>

      <h4>{note.subject}</h4>

      <p>{note.description}</p>

      <button>Open Notes</button>

    </div>
  );
};

export default NoteCard;