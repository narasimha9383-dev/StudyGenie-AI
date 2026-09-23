const Leaderboard = () => {
  const users = [
    { name: "Ananya", points: 1250, badge: "🥇" },
    { name: "Marco", points: 1180, badge: "🥈" },
    { name: "Lina", points: 1090, badge: "🥉" },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-card">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-600">
          Leaderboard
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-slate-950">
          Top learners this week
        </h2>
      </div>

      <div className="space-y-3">
        {users.map((user, index) => (
          <div
            key={user.name}
            className="flex items-center justify-between rounded-[24px] border border-slate-200 bg-white px-5 py-4 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-lg">
                {user.badge}
              </div>
              <div>
                <p className="font-semibold text-slate-900">
                  #{index + 1} {user.name}
                </p>
                <p className="text-sm text-slate-500">Consistency champion</p>
              </div>
            </div>
            <div className="text-sm font-semibold text-violet-600">
              {user.points} pts
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Leaderboard;
