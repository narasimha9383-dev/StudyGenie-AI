function LeaderboardCard({ rank, name, points }) {
  return (
    <div className="flex items-center justify-between rounded-[24px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div>
        <p className="text-sm font-semibold text-slate-500">#{rank}</p>
        <p className="mt-1 font-semibold text-slate-900">{name}</p>
      </div>
      <div className="text-sm font-semibold text-violet-600">{points} pts</div>
    </div>
  );
}

export default LeaderboardCard;
