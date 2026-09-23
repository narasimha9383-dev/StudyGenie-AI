const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");

const {
  chat,
  getChatHistory,
  deleteChatHistory,
} = require("../controllers/chatController");

const router = express.Router();

router.post("/", authMiddleware, chat);

router.get("/history", authMiddleware, getChatHistory);

router.delete("/history", authMiddleware, deleteChatHistory);

module.exports = router;
