import { motion } from "framer-motion";

const StatCard = ({
  title,
  value,
  icon,
  color
}) => {

  return (

    <motion.div

      whileHover={{
        y:-6
      }}

      className="stat-card"

    >

      <div
        className="stat-icon"
        style={{
          background:color
        }}
      >

        {icon}

      </div>

      <div>

        <h4>{title}</h4>

        <h2>{value}</h2>

      </div>

    </motion.div>

  );

};

export default StatCard;