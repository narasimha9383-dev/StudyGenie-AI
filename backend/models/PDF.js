const mongoose = require("mongoose");

const pdfSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: {
      type: String,
      required: true,
    },

    fileName: {
      type: String,
      required: true,
    },

    filePath: {
      type: String,
      required: true,
    },

    checksum: {
      type: String,
      required: true,
    },

    fileType: {
      type: String,
      default: "pdf",
    },

    sourceFile: {
      type: String,
      default: "",
    },

    pageCount: {
      type: Number,
      default: 0,
    },

    totalPages: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: ["awaiting_setup", "processing", "completed", "failed"],
      default: "awaiting_setup",
    },

    text: {
      type: String,
      default: "",
    },

    extractedText: {
      type: String,
      default: "",
    },

    ocrConfidence: {
      type: Number,
      default: null,
    },

    questionBlocks: {
      type: Array,
      default: undefined,
    },

    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

pdfSchema.index({ user: 1, createdAt: -1 });
pdfSchema.index({ user: 1, checksum: 1 }, { unique: true });

module.exports = mongoose.models.Pdf || mongoose.model("Pdf", pdfSchema);
