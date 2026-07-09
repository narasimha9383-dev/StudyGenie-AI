import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Moon, Search, SunMedium, UserCircle } from "lucide-react";

function Navbar() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    const storedTheme = localStorage.getItem("studygenie-theme") || "light";
    setTheme(storedTheme);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("studygenie-theme", theme);
  }, [theme]);

  return (
    <header className="sticky top-0 z-30 border-b border-sky-100/80 bg-white/85 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 items-center gap-4">
          <div className="hidden h-12 w-12 items-center justify-center rounded-3xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_12px_30px_rgba(2,132,199,0.25)] sm:flex">
            <span className="text-lg font-semibold">SG</span>
          </div>
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.32em] text-sky-600">
              StudyGenie
            </p>
            <h2 className="text-xl font-semibold text-slate-950 sm:text-2xl">
              Your modern learning command center
            </h2>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative hidden flex-1 items-center rounded-3xl border border-sky-100 bg-white px-4 py-3 shadow-sm sm:flex focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/20">
            <Search size={18} className="text-slate-400" />
            <input
              type="search"
              placeholder="Search your study plan"
              className="ml-3 w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none"
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-3xl border border-sky-100 bg-white text-slate-600 transition hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              aria-label="View notifications"
              onClick={() => navigate("/notifications")}
            >
              <Bell size={18} />
            </button>
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-3xl border border-sky-100 bg-white text-slate-600 transition hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              aria-label="Toggle theme"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon size={18} /> : <SunMedium size={18} />}
            </button>
            <button
              type="button"
              onClick={() => navigate("/profile")}
              className="inline-flex items-center gap-2 rounded-3xl border border-sky-100 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            >
              <UserCircle size={18} />
              <span className="hidden sm:inline">Ananya</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Navbar;
