import { Outlet } from "react-router-dom";
import Sidebar from "../components/layout/Sidebar";
import Navbar from "../components/layout/Navbar";
import Footer from "../components/layout/Footer";

function DashboardLayout() {
  return (
    <div className="app-shell min-h-screen">
      <Sidebar />
      <div className="flex min-h-screen flex-col lg:ml-[280px]">
        <Navbar />
        <main className="flex-1 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}

export default DashboardLayout;
