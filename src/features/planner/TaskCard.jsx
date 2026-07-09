function TaskCard() {
  const tasks = [
    { title: "Read chapter 4", time: "09:00" },
    { title: "Take quiz", time: "15:00" },
  ];

  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
        Tasks
      </p>
      <div className="mt-6 space-y-3">
        {tasks.map((task) => (
          <div
            key={task.title}
            className="flex items-center justify-between rounded-[20px] bg-slate-50 px-4 py-3"
          >
            <div>
              <p className="font-semibold text-slate-900">{task.title}</p>
              <p className="mt-1 text-sm text-slate-500">Priority: High</p>
            </div>
            <div className="text-sm font-semibold text-violet-600">
              {task.time}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default TaskCard;
