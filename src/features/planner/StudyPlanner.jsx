import Calendar from "./Calendar";
import TaskCard from "./TaskCard";

function StudyPlanner() {
  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
          Plan your week
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-slate-950">
          Study schedule
        </h2>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Calendar />
        <TaskCard />
      </div>
    </div>
  );
}

export default StudyPlanner;
