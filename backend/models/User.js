const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    passwordResetToken: String,
    passwordResetExpires: Date,

    firebaseUid: { type: String, sparse: true, unique: true, index: true },

    authProvider: {
      type: String,
      enum: ["local", "password", "google"],
      default: "local",
    },

    lastLogin: Date,

    accountStatus: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
    },

    avatar: {
      type: String,
      default: "",
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    college: { type: String, trim: true, default: "" },
    course: { type: String, trim: true, default: "" },
    year: { type: String, trim: true, default: "" },

    learningPreferences: {
      level: { type: String, default: "Intermediate" },
      explanationStyle: { type: String, default: "Like a Teacher" },
      outputLanguage: { type: String, default: "English" },
      aiPersonality: { type: String, default: "Friendly Teacher" },
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("User", userSchema);
