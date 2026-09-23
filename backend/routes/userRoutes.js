const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");

const {
  getProfile,
  updateProfile,
  deleteProfile,
  getLeaderboard,
  getAnalytics,
} = require("../controllers/userController");

const router = express.Router();

router.get("/profile", authMiddleware, getProfile);

router.put("/profile", authMiddleware, updateProfile);

router.delete("/profile", authMiddleware, deleteProfile);

router.get("/leaderboard", authMiddleware, getLeaderboard);
router.get("/analytics", authMiddleware, getAnalytics);

module.exports = router;
