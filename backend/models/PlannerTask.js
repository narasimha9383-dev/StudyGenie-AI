const mongoose = require("mongoose");

const plannerTaskSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  type: { type: String, enum: ["study", "revision", "quiz", "flashcards", "break"], default: "study" },
  subject: { type: String, default: "General" },
  topic: { type: String, default: "" },
  date: { type: Date, required: true, index: true },
  startTime: { type: String, default: "09:00" },
  duration: { type: Number, default: 45, min: 5, max: 720 },
  priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
  status: { type: String, enum: ["not_started", "in_progress", "completed", "skipped", "missed", "rescheduled"], default: "not_started" },
  resources: [{ type: { type: String }, resourceId: String, title: String }],
  notes: { type: String, default: "" },
  aiGenerated: { type: Boolean, default: false },
  completedAt: Date,
  actualDuration: { type: Number, default: null },
}, { timestamps: true });

plannerTaskSchema.index({ user: 1, date: 1, startTime: 1 });

module.exports = mongoose.models.PlannerTask || mongoose.model("PlannerTask", plannerTaskSchema);
