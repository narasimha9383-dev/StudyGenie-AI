import { useState } from "react";
import { ChevronDown } from "lucide-react";

function Dropdown({ label = "Select", items = [], onSelect }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(items[0] || label);

  const handleSelect = (item) => {
    setSelected(item);
    setOpen(false);
    onSelect?.(item);
  };

  return (
    <div className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 shadow-sm"
      >
        <span>{selected}</span>
        <ChevronDown
          size={16}
          className={`transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          {items.map((item) => (
            <li key={item}>
              <button
                type="button"
                onClick={() => handleSelect(item)}
                className="flex w-full items-center px-4 py-3 text-left text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
              >
                {item}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default Dropdown;
