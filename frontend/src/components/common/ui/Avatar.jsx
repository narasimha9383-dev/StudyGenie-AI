import { User } from "lucide-react";

function Avatar({ name = "Student", src, size = 48 }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <div
      className="inline-flex items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-gradient-to-br from-violet-500 to-indigo-500 text-white shadow-sm"
      style={{ width: size, height: size }}
      aria-label={name}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span className="text-sm font-semibold">
          {initials || <User size={size / 2.4} />}
        </span>
      )}
    </div>
  );
}

export default Avatar;
