import { Link } from "react-router-dom";

const NotFound = () => {
  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        placeItems: "center",
        textAlign: "center",
      }}
    >
      <div>
        <h1>404</h1>
        <p>Page Not Found</p>

        <Link to="/">Go Home</Link>
      </div>
    </div>
  );
};

export default NotFound;