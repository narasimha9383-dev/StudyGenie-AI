import "../../styles/common.css";

function Button({ text, onClick, type = "button" }) {
  return (
    <button className="primary-btn" type={type} onClick={onClick}>
      {text}
    </button>
  );
}

export default Button;