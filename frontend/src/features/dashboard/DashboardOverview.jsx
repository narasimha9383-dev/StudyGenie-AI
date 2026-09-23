import DashboardStats from "./DashboardStats";
import DashboardCharts from "./DashboardCharts";
import AIInsights from "./AIInsights";
import ContinueLearning from "./ContinueLearning";
import RecentActivity from "./RecentActivity";
import StudyStreak from "./StudyStreak";
import SubjectProgress from "./SubjectProgress";
import CalendarWidget from "./CalendarWidget";
import QuickActions from "./QuickActions";

const DashboardOverview = () => {
  return (
    <div className="dashboard">

      {/* Top Statistics */}
      <DashboardStats />

      {/* Charts Section */}
      <DashboardCharts />

      {/* Dashboard Widgets */}
      <div className="dashboard-grid">

        <AIInsights />

        <CalendarWidget />

        <ContinueLearning />

        <StudyStreak />

        <SubjectProgress />

        <RecentActivity />

        <QuickActions />

      </div>

    </div>
  );
};

export default DashboardOverview;