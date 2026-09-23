const leaderboardService = require("../services/leaderboardService");

const getLeaderboard = async (req, res, next) => {
  try {
    const leaderboard = await leaderboardService.getLeaderboard();

    res.status(200).json({
      success: true,
      count: leaderboard.length,
      leaderboard,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLeaderboard,
};
