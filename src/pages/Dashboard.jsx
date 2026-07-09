import {
  Sparkles,
  ClipboardList,
  CalendarDays,
  Bolt,
  BookOpen,
  ChevronRight,
} from "lucide-react";
import DashboardStats from "../features/dashboard/DashboardStats";

function Dashboard() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      <section className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <div className="rounded-[32px] bg-white p-8 shadow-[0_25px_70px_rgba(15,23,42,0.08)]">
          <p className="text-sm uppercase tracking-[0.32em] text-violet-600">
            Dashboard
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
            Good morning, Ananya
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
            Continue your study momentum with today&apos;s progress summary,
            upcoming tasks, and performance insights.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.26em] text-slate-500">
                Study Time
              </p>
              <p className="mt-4 text-3xl font-semibold text-slate-950">
                18h 42m
              </p>
              <p className="mt-2 text-sm text-emerald-600">
                +12% from last week
              </p>
            </div>
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.26em] text-slate-500">
                Quizzes Taken
              </p>
              <p className="mt-4 text-3xl font-semibold text-slate-950">24</p>
              <p className="mt-2 text-sm text-emerald-600">
                +8% from last week
              </p>
            </div>
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.26em] text-slate-500">
                Notes Created
              </p>
              <p className="mt-4 text-3xl font-semibold text-slate-950">36</p>
              <p className="mt-2 text-sm text-emerald-600">
                +15% from last week
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[32px] bg-gradient-to-br from-violet-600 to-indigo-600 p-8 text-white shadow-[0_25px_70px_rgba(15,23,42,0.18)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.32em] text-violet-200">
                Today&apos;s score
              </p>
              <h2 className="mt-4 text-3xl font-semibold">92 / 100</h2>
              <p className="mt-3 text-sm text-violet-100/90">
                A strong study day—keep the streak going and finish your
                remaining goals.
              </p>
            </div>
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-3xl bg-white/15 text-white shadow-lg">
              <Sparkles size={24} />
            </div>
          </div>

          <div className="mt-10 space-y-4 rounded-[28px] bg-white/10 p-5">
            <div className="flex items-center justify-between gap-3 rounded-3xl bg-white/15 px-4 py-4">
              <div>
                <p className="text-sm text-slate-100/80">Focus time</p>
                <p className="mt-1 text-xl font-semibold">4h 10m</p>
              </div>
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-3xl bg-violet-500/20 text-white">
                <span className="text-xl">⏱️</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-3xl bg-white/15 px-4 py-4">
              <div>
                <p className="text-sm text-slate-100/80">New concepts</p>
                <p className="mt-1 text-xl font-semibold">6 topics</p>
              </div>
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-3xl bg-violet-500/20 text-white">
                <BookOpen size={20} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.32em] text-violet-600">
              Key metrics
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950">
              Performance at a glance
            </h2>
          </div>
          <button className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200">
            View report
            <ChevronRight size={16} />
          </button>
        </div>

        <DashboardStats />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
        <div className="space-y-6">
          <div className="rounded-[32px] bg-white p-8 shadow-[0_25px_70px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.32em] text-violet-600">
                  Performance
                </p>
                <h3 className="mt-3 text-2xl font-semibold text-slate-950">
                  Learning overview
                </h3>
              </div>
              <div className="flex flex-wrap gap-3">
                {[
                  { label: "Today", active: true },
                  { label: "Week" },
                  { label: "Month" },
                ].map((item) => (
                  <button
                    key={item.label}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${item.active ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  title: "Accuracy",
                  value: "85%",
                  caption: "+5% from last week",
                  className: "bg-violet-600/10 text-violet-700",
                },
                {
                  title: "Flashcards",
                  value: "128",
                  caption: "+20%",
                  className: "bg-slate-50 text-slate-500",
                },
                {
                  title: "Rank",
                  value: "#12",
                  caption: "Good progress",
                  className: "bg-slate-50 text-slate-500",
                },
                {
                  title: "Notes",
                  value: "36",
                  caption: "+15%",
                  className: "bg-slate-50 text-slate-500",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className={`rounded-[24px] p-5 ${item.className}`}
                >
                  <p className="text-sm font-semibold uppercase tracking-[0.22em]">
                    {item.title}
                  </p>
                  <p className="mt-4 text-3xl font-semibold text-slate-950">
                    {item.value}
                  </p>
                  <p className="mt-2 text-sm text-slate-500">{item.caption}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[32px] bg-white p-8 shadow-[0_25px_70px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.32em] text-violet-600">
                  Study progress
                </p>
                <h3 className="mt-3 text-2xl font-semibold text-slate-950">
                  Current focus
                </h3>
              </div>
              <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
                68% overall
              </span>
            </div>

            <div className="mt-8 space-y-5">
              {[
                {
                  subject: "Data Structures",
                  value: 75,
                  color: "from-violet-500 to-indigo-500",
                },
                {
                  subject: "Database Systems",
                  value: 60,
                  color: "from-cyan-500 to-blue-500",
                },
                {
                  subject: "Operating Systems",
                  value: 80,
                  color: "from-emerald-500 to-teal-500",
                },
                {
                  subject: "Computer Networks",
                  value: 56,
                  color: "from-fuchsia-500 to-rose-500",
                },
              ].map((item) => (
                <div
                  key={item.subject}
                  className="space-y-3 rounded-[24px] border border-slate-200 p-4"
                >
                  <div className="flex items-center justify-between text-sm text-slate-700">
                    <span>{item.subject}</span>
                    <span>{item.value}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${item.color}`}
                      style={{ width: `${item.value}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[32px] bg-white p-8 shadow-[0_25px_70px_rgba(15,23,42,0.08)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.32em] text-violet-600">
                  Upcoming tasks
                </p>
                <h3 className="mt-3 text-2xl font-semibold text-slate-950">
                  Today&apos;s schedule
                </h3>
              </div>
              <button className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700">
                View calendar
              </button>
            </div>

            <div className="mt-8 space-y-4">
              {[
                { title: "Complete OS Notes", time: "Today, 5:00 PM" },
                { title: "Quiz: DBMS", time: "Tomorrow, 10:00 AM" },
                { title: "Practice Quiz", time: "May 24, 4:00 PM" },
              ].map((task) => (
                <div
                  key={task.title}
                  className="rounded-[28px] border border-slate-200 bg-slate-50 px-5 py-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-semibold text-slate-950">{task.title}</p>
                    <span className="text-sm text-slate-500">{task.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[32px] bg-white p-8 shadow-[0_25px_70px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.32em] text-violet-600">
                  Daily goal
                </p>
                <h3 className="mt-3 text-2xl font-semibold text-slate-950">
                  75% completed
                </h3>
              </div>
              <div className="h-24 w-24 rounded-full bg-violet-600/10 p-3">
                <div className="relative flex h-full w-full items-center justify-center rounded-full bg-violet-600 text-white">
                  75%
                </div>
              </div>
            </div>

            <div className="mt-8 space-y-4">
              {[
                "Study Time (2h)",
                "Notes (1)",
                "Quiz (1)",
                "Flashcards (20)",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center justify-between rounded-[28px] bg-slate-50 px-5 py-4 text-sm text-slate-700"
                >
                  <span>{item}</span>
                  <span className="text-emerald-600 font-semibold">Done</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[32px] bg-white p-8 shadow-[0_25px_70px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.32em] text-violet-600">
                  Quick actions
                </p>
                <h3 className="mt-3 text-2xl font-semibold text-slate-950">
                  Get things done
                </h3>
              </div>
              <button className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200">
                View all
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="mt-8 grid gap-3">
              {[
                { label: "Upload PDF", icon: <ClipboardList size={18} /> },
                { label: "Generate Quiz", icon: <Bolt size={18} /> },
                { label: "Review Notes", icon: <BookOpen size={18} /> },
                { label: "Planner", icon: <CalendarDays size={18} /> },
              ].map((action) => (
                <button
                  key={action.label}
                  className="flex w-full items-center justify-between rounded-[28px] border border-slate-200 bg-slate-50 px-5 py-4 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  <span className="inline-flex items-center gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-3xl bg-violet-100 text-violet-600">
                      {action.icon}
                    </span>
                    {action.label}
                  </span>
                  <ChevronRight size={18} className="text-slate-400" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Dashboard;
