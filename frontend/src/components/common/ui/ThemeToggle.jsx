import { useState } from "react";
import { Moon, SunMedium } from "lucide-react";

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setDark((value) => !value)}
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm"
    >
      {dark ? <Moon size={16} /> : <SunMedium size={16} />}
      <span>{dark ? "Dark" : "Light"}</span>
    </button>
  );
}

export default ThemeToggle;
