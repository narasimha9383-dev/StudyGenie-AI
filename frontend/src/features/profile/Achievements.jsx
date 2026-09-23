function Achievements() {
  const items = [
    { title: "Consistency streak", value: "7 days" },
    { title: "Quizzes mastered", value: "24" },
    { title: "Notes created", value: "36" },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.title}
          className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm"
        >
          <p className="text-sm text-slate-500">{item.title}</p>
          <p className="mt-3 text-2xl font-semibold text-slate-950">
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

export default Achievements;
