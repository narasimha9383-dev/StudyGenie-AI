const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");

const {
  generateFlashcards,
  getFlashcards,
  updateFlashcard,
  deleteFlashcard,
} = require("../controllers/flashcardController");

const router = express.Router();

router.post("/generate", authMiddleware, generateFlashcards);

router.get("/:pdfId", authMiddleware, getFlashcards);

router.put("/:flashcardId", authMiddleware, updateFlashcard);

router.delete("/:flashcardId", authMiddleware, deleteFlashcard);

module.exports = router;
