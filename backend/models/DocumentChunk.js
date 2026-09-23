const mongoose = require("mongoose");

const documentChunkSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  pdf: { type: mongoose.Schema.Types.ObjectId, ref: "Pdf", required: true, index: true },
  title: { type: String, default: "" },
  chunkId: { type: String, required: true },
  index: { type: Number, required: true },
  text: { type: String, required: true },
  metadata: { type: Object, default: {} },
  embedding: { type: [Number], required: true },
}, { timestamps: true });

documentChunkSchema.index({ user: 1, pdf: 1, index: 1 }, { unique: true });
documentChunkSchema.index({ user: 1, chunkId: 1 }, { unique: true });

module.exports = mongoose.models.DocumentChunk || mongoose.model("DocumentChunk", documentChunkSchema);
