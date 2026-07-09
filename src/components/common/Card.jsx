import "../../styles/common.css";

function Card({ title, children }) {
  return (
    <div className="common-card">
      {title && <h3>{title}</h3>}
      {children}
    </div>
  );
}

export default Card;