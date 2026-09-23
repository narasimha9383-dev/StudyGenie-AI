import { Navigate, Outlet } from "react-router-dom";

function PrivateRoute() {
  const isAuthenticated = Boolean(localStorage.getItem("user"));
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
}

export default PrivateRoute;
