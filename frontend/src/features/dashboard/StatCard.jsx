import { motion } from "framer-motion";

const StatCard = ({ title, value, icon, color }) => {
  return (
    <motion.div
      whileHover={{ y: -6 }}
      className="rounded-[28px] border border-slate-200/80 bg-white p-6 shadow-card transition"
    >
      <div className="flex items-center gap-4">
        <div
          className="inline-flex h-14 w-14 items-center justify-center rounded-3xl text-slate-900"
          style={{ background: color }}
        >
          {icon}
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
            {title}
          </p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">{value}</p>
        </div>
      </div>
    </motion.div>
  );
};

export default StatCard;
