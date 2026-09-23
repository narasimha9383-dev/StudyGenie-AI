import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Minus, RefreshCw, Sparkles, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchLeaderboard } from "../services/leaderboardService";

const periods = ["weekly", "monthly", "overall"];
const subjects = ["all", "data structures", "dbms", "operating systems", "computer networks", "computer architecture"];

const formatSubject = (subject) => subject === "all" ? "All Subjects" : subject.replace(/\b\w/g, (letter) => letter.toUpperCase());
const display = (value, suffix = "") => value === null || value === undefined ? "—" : `${value}${suffix}`;

function Initials({ name, avatar }) {
  if (avatar) return <img src={avatar} alt="" className="h-11 w-11 rounded-full object-cover" />;
  const initials = String(name || "Student").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <span className="grid h-11 w-11 place-items-center rounded-full bg-[#39ff14]/15 text-sm font-bold text-[#65ff45]">{initials}</span>;
}

function LoadingState() {
  return <div className="space-y-6" role="status" aria-label="Loading leaderboard"><div className="grid gap-4 md:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-40 animate-pulse rounded-2xl border border-white/10 bg-white/[.04]" />)}</div><div className="h-80 animate-pulse rounded-2xl border border-white/10 bg-white/[.04]" /></div>;
}

function Movement({ value }) {
  if (value === null || value === undefined || value === 0) return <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><Minus size={14} />No movement</span>;
  const up = value > 0;
  return <span className={`inline-flex items-center gap-1 text-xs ${up ? "text-[#65ff45]" : "text-red-300"}`}>{up ? <ArrowUp size={14} /> : <ArrowDown size={14} />}{Math.abs(value)} position{Math.abs(value) === 1 ? "" : "s"}</span>;
}

export default function Leaderboard() {
  const [period, setPeriod] = useState("weekly");
  const [subject, setSubject] = useState("all");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    fetchLeaderboard({ period, subject }).then(setData).catch((requestError) => setError(requestError.response?.data?.message || "Unable to load leaderboard. Please try again.")).finally(() => setLoading(false));
  };

  useEffect(load, [period, subject]);
  const topThree = useMemo(() => (data?.rankings || []).slice(0, 3), [data]);
  const currentUser = data?.currentUser;

  return <section className="mx-auto max-w-6xl space-y-6 pb-10">
    <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.22em] text-[#65ff45]">Community learning</p><h1 className="mt-2 flex items-center gap-3 text-3xl font-bold text-white"><Trophy className="text-[#65ff45]" />LEADERBOARD</h1><p className="mt-2 text-sm text-zinc-400">Compete with classmates. Stay consistent. Learn better.</p></div><div className="flex flex-wrap gap-3"><div className="flex rounded-xl border border-white/10 bg-white/[.03] p-1" aria-label="Leaderboard period">{periods.map((item) => <button type="button" key={item} onClick={() => setPeriod(item)} className={`rounded-lg px-3 py-2 text-xs capitalize ${period === item ? "bg-[#39ff14] font-semibold text-[#071006]" : "text-zinc-400 hover:text-white"}`}>{item}</button>)}</div><select value={subject} onChange={(event) => setSubject(event.target.value)} aria-label="Subject filter" className="rounded-xl border border-white/10 bg-[#101311] px-3 py-2 text-xs text-zinc-200 outline-none">{subjects.map((item) => <option key={item} value={item}>{formatSubject(item)}</option>)}</select></div></header>

    {!loading && !error && data && !data.subjectFilteringAvailable && subject !== "all" && <p className="rounded-xl border border-amber-300/20 bg-amber-300/[.06] p-3 text-xs text-amber-100/80">Subject tags are not stored on current study materials yet, so this view is showing all subjects.</p>}
    {loading && <LoadingState />}
    {!loading && error && <div role="alert" className="rounded-2xl border border-red-400/30 bg-red-500/10 p-8 text-center"><h2 className="text-lg font-semibold text-red-200">Unable to load leaderboard</h2><p className="mt-2 text-sm text-red-200/70">Please try again.</p><button type="button" onClick={load} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-red-300/40 px-4 py-2 text-sm text-red-100 hover:bg-red-500/10"><RefreshCw size={15} />Retry</button></div>}
    {!loading && !error && !data?.rankings?.length && <div className="rounded-2xl border border-white/10 bg-[#0d1110] p-10 text-center"><Trophy className="mx-auto text-[#65ff45]" size={35} /><h2 className="mt-4 text-xl font-semibold text-white">No rankings yet</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">Start studying and complete your first learning activity to appear on the leaderboard.</p><Link to="/upload" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#39ff14] px-5 py-3 text-sm font-bold text-[#071006]"><Sparkles size={16} />Start Studying</Link></div>}
    {!loading && !error && data?.rankings?.length > 0 && <>
      <section aria-labelledby="top-performers"><div className="mb-3 flex items-center justify-between"><h2 id="top-performers" className="text-lg font-semibold text-white">Top performers</h2><span className="text-xs text-zinc-500">{formatSubject(data.subject)} · {data.period}</span></div><div className="grid gap-4 md:grid-cols-3">{topThree.map((student, index) => <article key={student.userId} className={`rounded-2xl border p-6 text-center ${index === 0 ? "border-[#39ff14]/50 bg-[#39ff14]/[.08] shadow-[0_0_28px_rgba(57,255,20,.08)]" : "border-white/10 bg-[#0d1110]"}`}><div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-widest text-zinc-500"><span>{["🥇", "🥈", "🥉"][index]}</span>Rank {student.rank}</div><div className="mt-4 flex justify-center"><Initials name={student.name} avatar={student.avatar} /></div><h3 className="mt-3 font-semibold text-white">{student.name}</h3><p className="mt-1 text-sm text-[#65ff45]">{student.points.toLocaleString()} points</p></article>)}</div></section>

      <section aria-labelledby="ranking-table" className="overflow-hidden rounded-2xl border border-white/10 bg-[#0d1110]"><div className="flex items-center justify-between border-b border-white/[.07] p-5"><h2 id="ranking-table" className="text-lg font-semibold text-white">Learning rankings</h2><span className="text-xs text-zinc-500">Meaningful activity only</span></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-white/[.025] text-xs text-zinc-500"><tr><th className="px-5 py-3">Rank</th><th className="px-5 py-3">Student</th><th className="px-5 py-3">Study Hours</th><th className="px-5 py-3">Questions</th><th className="px-5 py-3">Accuracy</th><th className="px-5 py-3 text-right">Points</th></tr></thead><tbody>{data.rankings.map((student) => <tr key={student.userId} className="border-t border-white/[.06] hover:bg-white/[.025]"><td className="px-5 py-4 font-semibold text-[#65ff45]">#{student.rank}</td><td className="px-5 py-4"><div className="flex items-center gap-3"><Initials name={student.name} avatar={student.avatar} /><span className="text-zinc-200">{student.name}</span></div></td><td className="px-5 py-4 text-zinc-400">{display(student.studyHours, " hrs")}</td><td className="px-5 py-4 text-zinc-400">{display(student.questionsPracticed)}</td><td className="px-5 py-4 text-zinc-400">{display(student.accuracy, "%")}</td><td className="px-5 py-4 text-right font-semibold text-white">{student.points.toLocaleString()}</td></tr>)}</tbody></table></div></section>

      <section aria-labelledby="your-position" className="rounded-2xl border border-[#39ff14]/25 bg-[#39ff14]/[.05] p-6"><div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between"><div><p id="your-position" className="text-xs font-semibold uppercase tracking-[.2em] text-[#65ff45]">Your position</p><p className="mt-2 text-4xl font-bold text-white">#{currentUser?.rank || "—"}</p><p className="mt-1 text-sm text-zinc-300">{currentUser ? `${currentUser.points.toLocaleString()} Points` : "Complete a learning activity to rank"}</p><div className="mt-3"><Movement value={currentUser?.movement} /></div></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs text-zinc-500">Study Hours</p><p className="mt-1 font-semibold text-white">{display(currentUser?.studyHours, " hrs")}</p></div><div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs text-zinc-500">Questions</p><p className="mt-1 font-semibold text-white">{display(currentUser?.questionsPracticed)}</p></div><div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs text-zinc-500">Accuracy</p><p className="mt-1 font-semibold text-white">{display(currentUser?.accuracy, "%")}</p></div></div></div></section>
    </>}
  </section>;
}
