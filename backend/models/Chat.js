const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    pdf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pdf",
    },

    question: {
      type: String,
      required: true,
    },

    answer: {
      type: String,
      required: true,
    },

    sources: [
      {
        pdf_id: String,
        chunk_id: String,
        page_number: Number,
        page: Number,
        chunkId: String,
        title: String,
        score: Number,
      },
    ],

    relatedConcepts: { type: [String], default: [] },
    confidence: { type: Number, min: 0, max: 1, default: null },
    retrievalMethod: { type: String, default: "unknown" },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Chat", chatSchema);
