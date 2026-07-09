import { Outlet } from "react-router-dom";

function LandingLayout() {
  return (
    <div className="min-h-screen bg-slate-100">
      <Outlet />
    </div>
  );
}

export default LandingLayout;
