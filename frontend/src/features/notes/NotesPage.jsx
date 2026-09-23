import "./../../styles/notes.css";
import NotesHeader from "./NotesHeader";
import NotesGrid from "./NotesGrid";

const NotesPage = () => {
  return (
    <div className="notes-page">
      <NotesHeader />
      <NotesGrid />
    </div>
  );
};

export default NotesPage;