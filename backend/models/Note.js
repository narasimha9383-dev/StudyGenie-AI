const mongoose = require("mongoose");

const noteSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    pdf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pdf",
      required: true,
    },

    title: String,

    content: {
      type: String,
      required: true,
    },

    rawPdf: { type: mongoose.Schema.Types.ObjectId, ref: "Pdf" },
    questionPdf: { type: mongoose.Schema.Types.ObjectId, ref: "Pdf" },
    generationType: { type: String, enum: ["notes", "qa", "quiz", "10_mark"], default: "qa" },
    questionInputs: { type: Array, default: undefined },
    pdfPath: String,
    downloadUrl: String,
    status: { type: String, enum: ["processing", "completed", "failed"], default: "completed" },
    error: { type: Object, default: undefined },
    generatedNotes: { type: Object, default: undefined },
    questions: { type: Array, default: undefined },
    sourcePages: { type: Array, default: undefined },
    processing: { type: Object, default: undefined },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Note", noteSchema);
