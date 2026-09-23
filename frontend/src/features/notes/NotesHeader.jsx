import { Search } from "lucide-react";

const NotesHeader = () => {
  return (
    <div className="notes-header">

      <div>
        <h1>My Notes</h1>
        <p>Manage all your study notes</p>
      </div>

      <div className="notes-actions">

        <div className="notes-search">
          <Search size={18} />
          <input
            placeholder="Search notes..."
          />
        </div>

        <button className="add-note-btn">
          + New Note
        </button>

      </div>

    </div>
  );
};

export default NotesHeader;