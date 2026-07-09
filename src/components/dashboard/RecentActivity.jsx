import { Clock3 } from "lucide-react";

function RecentActivity() {
  const items = [
    { title: "Completed quiz", detail: "Statistics • 10 mins ago" },
    { title: "Created flashcards", detail: "Machine learning • 35 mins ago" },
    { title: "Uploaded notes", detail: "Biology • 1 hour ago" },
  ];

  return (
    <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-500">
          Recent activity
        </p>
        <h3 className="mt-3 text-xl font-semibold text-slate-950">
          Latest wins
        </h3>
      </div>

      <div className="mt-6 space-y-3">
        {items.map((item) => (
          <div
            key={item.title}
            className="flex items-start gap-3 rounded-[24px] bg-slate-50 px-4 py-3"
          >
            <div className="rounded-2xl bg-white p-2 text-slate-600 shadow-sm">
              <Clock3 size={16} />
            </div>
            <div>
              <p className="font-semibold text-slate-900">{item.title}</p>
              <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default RecentActivity;
