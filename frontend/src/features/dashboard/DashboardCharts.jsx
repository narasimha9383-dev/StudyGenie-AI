import ProgressChart from "./ProgressChart";

const DashboardCharts = () => {
  return (
    <div className="charts-container">
      <div className="chart-card">
        <h3>Weekly Study Progress</h3>
        <ProgressChart />
      </div>

      <div className="chart-card">
        <h3>Today's Goal</h3>

        <div className="goal-box">
          <div className="goal-circle">
            <h1>82%</h1>
            <p>Completed</p>
          </div>

          <div>
            <h4>Target</h4>
            <p>5 Study Hours</p>

            <h4>Completed</h4>
            <p>4.1 Hours</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardCharts;