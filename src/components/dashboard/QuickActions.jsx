import { ArrowRight, BookOpen, FileUp, MessageSquareText } from "lucide-react";

function QuickActions() {
  const actions = [
    { title: "Upload PDF", icon: FileUp, hint: "Summarize a new lecture" },
    {
      title: "Generate notes",
      icon: BookOpen,
      hint: "Turn ideas into study notes",
    },
    {
      title: "Ask AI tutor",
      icon: MessageSquareText,
      hint: "Get help instantly",
    },
  ];

  return (
    <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
          Quick actions
        </p>
        <h3 className="mt-3 text-xl font-semibold text-slate-950">
          Jump back in
        </h3>
      </div>

      <div className="mt-6 space-y-3">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.title}
              className="flex w-full items-center justify-between rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-violet-200 hover:bg-violet-50"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-white p-2 text-violet-600 shadow-sm">
                  <Icon size={18} />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">{action.title}</p>
                  <p className="mt-1 text-sm text-slate-500">{action.hint}</p>
                </div>
              </div>
              <ArrowRight size={18} className="text-slate-400" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default QuickActions;
