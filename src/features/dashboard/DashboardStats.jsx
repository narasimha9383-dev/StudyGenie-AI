import { BookOpen, Clock3, BrainCircuit, Trophy } from "lucide-react";
import StatCard from "./StatCard";

const DashboardStats = () => {
  const stats = [
    {
      title: "Study Hours",
      value: "42",
      icon: <Clock3 size={28} />,
      color: "#8b5cf6",
    },
    {
      title: "Notes",
      value: "128",
      icon: <BookOpen size={28} />,
      color: "#14b8a6",
    },
    {
      title: "AI Sessions",
      value: "64",
      icon: <BrainCircuit size={28} />,
      color: "#f59e0b",
    },
    {
      title: "Leaderboard",
      value: "#5",
      icon: <Trophy size={28} />,
      color: "#fb7185",
    },
  ];

  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((item, index) => (
        <StatCard key={index} {...item} />
      ))}
    </div>
  );
};

export default DashboardStats;
