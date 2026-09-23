import { useState } from "react";
import { Search } from "lucide-react";

function SearchBar({ placeholder = "Search", onSearch }) {
  const [query, setQuery] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    onSearch?.(query);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-3 shadow-sm"
    >
      <Search size={18} className="text-slate-400" />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        className="w-full border-none bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
      />
    </form>
  );
}

export default SearchBar;
