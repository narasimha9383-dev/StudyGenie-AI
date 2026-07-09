import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip
} from "recharts";

const data = [

  { day: "Mon", hours: 2 },
  { day: "Tue", hours: 4 },
  { day: "Wed", hours: 5 },
  { day: "Thu", hours: 3 },
  { day: "Fri", hours: 6 },
  { day: "Sat", hours: 8 },
  { day: "Sun", hours: 7 }

];

const ProgressChart = () => {

  return (

    <ResponsiveContainer
      width="100%"
      height={320}
    >

      <LineChart
        data={data}
      >

        <CartesianGrid strokeDasharray="3 3"/>

        <XAxis dataKey="day"/>

        <YAxis/>

        <Tooltip/>

        <Line
          type="monotone"
          dataKey="hours"
          stroke="#6C63FF"
          strokeWidth={4}
        />

      </LineChart>

    </ResponsiveContainer>

  );

};

export default ProgressChart;