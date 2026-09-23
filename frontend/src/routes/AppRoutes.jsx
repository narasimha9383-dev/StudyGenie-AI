import { Routes, Route } from "react-router-dom";

import Landing from "../pages/Landing";
import Login from "../pages/Login";
import Register from "../pages/Register";
import ForgotPassword from "../pages/ForgotPassword";
import ResetPassword from "../pages/ResetPassword";

import Dashboard from "../pages/Dashboard";
import UploadPDF from "../pages/UploadPDF";
import Library from "../pages/Library";
import Notes from "../pages/Notes";
import Quiz from "../pages/Quiz";
import Chatbot from "../pages/Chatbot";
import Flashcards from "../pages/Flashcards";
import Leaderboard from "../pages/Leaderboard";
import Profile from "../pages/Profile";
import Settings from "../pages/Settings";

import Analytics from "../pages/Analytics";
import Planner from "../pages/Planner";
import Notifications from "../pages/Notifications";
import NotFound from "../pages/NotFound";

import DashboardLayout from "../layouts/DashboardLayout";
import ProtectedRoute from "../components/common/ProtectedRoute";
import PublicRoute from "./PublicRoute";

function AppRoutes() {
  return (
    <Routes>
      {/* Public Routes */}

      <Route path="/" element={<Landing />} />

      <Route element={<PublicRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />
      </Route>

      {/* Protected Dashboard Layout */}

      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />

          <Route path="/upload" element={<UploadPDF />} />

          <Route path="/library" element={<Library />} />

          <Route path="/notes" element={<Notes />} />

          <Route path="/quiz" element={<Quiz />} />

          <Route path="/chatbot" element={<Chatbot />} />

          <Route path="/flashcards" element={<Flashcards />} />

          <Route path="/leaderboard" element={<Leaderboard />} />

          <Route path="/profile" element={<Profile />} />

          <Route path="/settings" element={<Settings />} />

          <Route path="/analytics" element={<Analytics />} />

          <Route path="/planner" element={<Planner />} />

          <Route path="/notifications" element={<Notifications />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default AppRoutes;
