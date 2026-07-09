import notes from "./notesData";
import NoteCard from "./NoteCard";

const NotesGrid = () => {
  return (
    <div className="notes-grid">
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
        />
      ))}
    </div>
  );
};

export default NotesGrid;