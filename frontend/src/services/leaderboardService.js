import api from "../api/axios";

export const fetchLeaderboard = ({ period, subject }) => api.get("/user/leaderboard", { params: { period, subject } }).then(({ data }) => data);
