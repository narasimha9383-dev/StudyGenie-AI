import { Navigate, Outlet } from "react-router-dom";

function PublicRoute() {
  const isAuthenticated = Boolean(localStorage.getItem("user"));
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <Outlet />;
}

export default PublicRoute;
