import "../../styles/common.css";

function EmptyState({ message }) {
  return (
    <div className="empty-state">
      <h2>📂</h2>
      <p>{message}</p>
    </div>
  );
}

export default EmptyState;