import { useState, useContext } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AuthContext } from "../../context/AuthContext";
import {
  Menu,
  X,
  Home,
  BookOpen,
  ClipboardList,
  Brain,
  Layers,
  Trophy,
  ChartBar,
  CalendarDays,
  Bell,
  User,
  Settings,
  FileText,
  Sparkles,
} from "lucide-react";

function Sidebar() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useContext(AuthContext);

  const menuItems = [
    { icon: Home, label: "Dashboard", href: "/dashboard" },
    { icon: BookOpen, label: "Notes", href: "/notes" },
    { icon: ClipboardList, label: "Quizzes", href: "/quiz" },
    { icon: CalendarDays, label: "Study Planner", href: "/planner" },
    { icon: Layers, label: "Flashcards", href: "/flashcards" },
    { icon: Brain, label: "AI Chat", href: "/chatbot" },
    { icon: ChartBar, label: "Analytics", href: "/analytics" },
    { icon: Trophy, label: "Leaderboard", href: "/leaderboard" },
    { icon: User, label: "Profile", href: "/profile" },
    { icon: Settings, label: "Settings", href: "/settings" },
  ];

  const secondaryItems = [
    { icon: FileText, label: "Upload PDF", href: "/upload" },
    { icon: Bell, label: "Notifications", href: "/notifications" },
  ];

  const handleLogout = () => {
    logout();
    navigate("/login");
    setOpen(false);
  };

  const handleNavigation = (href) => {
    navigate(href);
    setOpen(false);
  };

  return (
    <>
      <button
        className="fixed left-4 top-4 z-50 inline-flex h-12 w-12 items-center justify-center rounded-3xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_18px_45px_rgba(2,132,199,0.28)] transition hover:scale-[1.02] hover:from-sky-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-sky-500/40 lg:hidden"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
      >
        <Menu size={24} />
      </button>

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[286px] flex-col overflow-hidden border-r border-sky-100/80 bg-white/90 px-5 py-5 shadow-[0_30px_90px_rgba(2,132,199,0.16)] backdrop-blur-xl transition-all duration-300 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-lg shadow-sky-500/20">
              <Sparkles size={19} />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-sky-600">
                StudyGenie
              </p>
              <h2 className="text-lg font-semibold tracking-tight text-slate-950">
                AI Workspace
              </h2>
            </div>
          </div>
          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 text-slate-700 transition hover:bg-sky-100 focus:outline-none focus:ring-2 focus:ring-sky-500/30 lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mt-6 rounded-[24px] border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-blue-50 p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">
            Premium study workspace
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Everything you need to learn with calm focus and momentum.
          </p>
        </div>

        <div className="mt-6 flex-1 overflow-y-auto pr-1">
          <nav className="space-y-2">
            {menuItems.map((item) => {
              const isActive = location.pathname === item.href;
              const Icon = item.icon;
              return (
                <button
                  key={item.href}
                  onClick={() => handleNavigation(item.href)}
                  className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-semibold transition-all duration-200 ${
                    isActive
                      ? "bg-sky-600 text-white shadow-lg shadow-sky-500/20"
                      : "text-slate-700 hover:-translate-y-0.5 hover:bg-sky-50 hover:text-slate-950"
                  }`}
                >
                  <span
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl transition ${
                      isActive
                        ? "bg-white/15 text-white"
                        : "bg-slate-100 text-slate-600 group-hover:bg-white group-hover:text-sky-600"
                    }`}
                  >
                    <Icon size={18} />
                  </span>
                  <span>{item.label}</span>
                  {isActive ? (
                    <span className="ml-auto h-2.5 w-2.5 rounded-full bg-white/90" />
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="mt-6 rounded-[24px] border border-sky-100 bg-sky-50/70 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Focus mode</h3>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Clear navigation keeps you in flow while you study.
            </p>
          </div>

          <div className="mt-6 space-y-2">
            {secondaryItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.href;
              return (
                <button
                  key={item.href}
                  onClick={() => handleNavigation(item.href)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-semibold transition-all duration-200 ${
                    isActive
                      ? "bg-sky-600 text-white shadow-lg shadow-sky-500/20"
                      : "text-slate-700 hover:-translate-y-0.5 hover:bg-sky-50 hover:text-slate-950"
                  }`}
                >
                  <span
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl transition ${
                      isActive
                        ? "bg-white/15 text-white"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    <Icon size={18} />
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 border-t border-sky-100 pt-4">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-2xl bg-slate-100 px-3 py-3 text-left text-sm font-semibold text-slate-900 transition hover:bg-slate-200"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
              <X size={18} />
            </span>
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {open && (
        <button
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
          aria-label="Close overlay"
        />
      )}
    </>
  );
}

export default Sidebar;
