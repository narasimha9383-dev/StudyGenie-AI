const User = require("../models/User");
const leaderboardService = require("./leaderboardService");

const getProfile = async (userId) => {
  const user = await User.findById(userId).select("-password");

  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  return user;
};

const updateProfile = async (userId, payload) => {
  const user = await User.findById(userId);

  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  const allowedFields = ["name", "avatar"];
  allowedFields.forEach((field) => {
    if (payload[field] !== undefined) {
      user[field] = payload[field];
    }
  });

  await user.save();
  return user.toObject();
};

const deleteProfile = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  const pdfService = require("./pdfService");
  const PDFs = require("../models/PDF");
  const pdfs = await PDFs.find({ user: userId }).select("_id");
  await Promise.all(pdfs.map((pdf) => pdfService.deletePdf(pdf._id, userId)));
  await require("../models/Chat").deleteMany({ user: userId });
  await User.deleteOne({ _id: userId });
};

const getLeaderboard = async (filters) => leaderboardService.getLeaderboard(filters);

const getAnalytics = async (userId) => {
  const [pdfs, notes, quizzes, flashcards, learnedCards, chats] = await Promise.all([
    require("../models/PDF").countDocuments({ user: userId }),
    require("../models/Note").countDocuments({ user: userId }),
    require("../models/Quiz").countDocuments({ user: userId }),
    require("../models/FlashCards").countDocuments({ user: userId }),
    require("../models/FlashCards").countDocuments({ user: userId, isLearned: true }),
    require("../models/Chat").countDocuments({ user: userId }),
  ]);
  return { pdfs, notes, quizzes, flashcards, learnedCards, chats, flashcardProgress: flashcards ? Math.round((learnedCards / flashcards) * 100) : 0 };
};

module.exports = {
  getProfile,
  updateProfile,
  deleteProfile,
  getLeaderboard,
  getAnalytics,
};
