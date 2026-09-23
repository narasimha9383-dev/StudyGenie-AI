const userService = require("../services/userService");

// Get logged-in user's profile
const getProfile = async (req, res, next) => {
  try {
    const user = await userService.getProfile(req.user.id);

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    next(error);
  }
};

// Update logged-in user's profile
const updateProfile = async (req, res, next) => {
  try {
    const updatedUser = await userService.updateProfile(req.user.id, req.body);

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

// Delete logged-in user's account
const deleteProfile = async (req, res, next) => {
  try {
    await userService.deleteProfile(req.user.id);

    res.status(200).json({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

const getLeaderboard = async (req, res, next) => {
  try {
    const leaderboard = await userService.getLeaderboard({
      userId: req.user.id,
      period: req.query.period,
      subject: req.query.subject,
    });
    res.status(200).json({ success: true, ...leaderboard });
  } catch (error) {
    next(error);
  }
};

const getAnalytics = async (req, res, next) => {
  try {
    const analytics = await userService.getAnalytics(req.user.id);
    res.status(200).json({ success: true, analytics });
  } catch (error) { next(error); }
};

module.exports = {
  getProfile,
  updateProfile,
  deleteProfile,
  getLeaderboard,
  getAnalytics,
};
