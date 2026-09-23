const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");

const {
  generateQuiz,
  getQuiz,
  deleteQuiz,
  submitQuiz,
} = require("../controllers/quizController");

const router = express.Router();

router.post("/generate", authMiddleware, generateQuiz);

router.post("/submit/:quizId", authMiddleware, submitQuiz);

router.get("/:quizId", authMiddleware, getQuiz);

router.delete("/:quizId", authMiddleware, deleteQuiz);

module.exports = router;
