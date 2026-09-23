const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

const {
  uploadPdf,
  setupPdf,
  getAllPdfs,
  getPdfById,
  downloadPdf,
  getProcessingStatus,
  deletePdf,
} = require("../controllers/pdfController");

const router = express.Router();

router.post("/upload", authMiddleware, upload.single("pdf"), uploadPdf);

router.post("/:pdfId/setup", authMiddleware, setupPdf);

router.get("/", authMiddleware, getAllPdfs);

router.get("/:pdfId/download", authMiddleware, downloadPdf);

router.get("/:pdfId/processing", authMiddleware, getProcessingStatus);

router.get("/:pdfId", authMiddleware, getPdfById);

router.delete("/:pdfId", authMiddleware, deletePdf);

module.exports = router;
