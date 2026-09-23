const mongoose = require("mongoose");

const quizSchema = new mongoose.Schema(
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

    questions: [
      {
        question: String,

        options: [String],

        answer: String,

        explanation: String,
      },
    ],

    attempts: [
      {
        answers: [String],
        score: Number,
        total: Number,
        accuracy: Number,
        submittedAt: Date,
      },
    ],
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Quiz", quizSchema);
