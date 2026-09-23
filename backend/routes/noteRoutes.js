const express = require("express");
const multer = require("multer");
const authMiddleware = require("../middleware/authMiddleware");

const questionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) {
      const error = new Error("Question image must be PNG, JPG, JPEG, or WEBP.");
      error.statusCode = 400;
      return callback(error);
    }
    return callback(null, true);
  },
});

const {
  generateNotes,
  getNotes,
  listGeneratedNotes,
  generateQuestionAnswerPdf,
  getGenerationStatus,
  downloadGeneratedPdf,
  deleteNote,
} = require("../controllers/noteController");

const router = express.Router();

router.post("/generate", authMiddleware, generateNotes);

router.post("/generate-pdf", authMiddleware, questionUpload.array("questionImages", 10), generateQuestionAnswerPdf);
router.get("/:noteId/status", authMiddleware, getGenerationStatus);

router.get("/", authMiddleware, listGeneratedNotes);

router.get("/:noteId/download", authMiddleware, downloadGeneratedPdf);

router.get("/:pdfId", authMiddleware, getNotes);

router.delete("/:noteId", authMiddleware, deleteNote);

module.exports = router;
