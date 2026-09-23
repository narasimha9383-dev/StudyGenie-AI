const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();

const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const pdfRoutes = require("./routes/pdfRoutes");
const userRoutes = require("./routes/userRoutes");
const chatRoutes = require("./routes/chatRoutes");
const noteRoutes = require("./routes/noteRoutes");
const quizRoutes = require("./routes/quizRoutes");
const flashCardsRoutes = require("./routes/flashCardsRoutes");
const plannerRoutes = require("./routes/plannerRoutes");
const errorMiddleware = require("./middleware/errorMiddleware");
const { localLlamaManager } = require("./services/localLlamaManager");

const app = express();

const normalizeOrigin = (origin) => origin.trim().replace(/\/$/, "");
const configuredOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);
const defaultDevelopmentOrigins = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174", "http://localhost:4173", "http://127.0.0.1:4173"];
const allowedOrigins = new Set([...defaultDevelopmentOrigins, ...configuredOrigins].map(normalizeOrigin));
const isLocalDevelopmentOrigin = (origin) => process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(origin);

app.use(
  cors({
    origin: (origin, callback) => {
      // Non-browser requests (health checks, local CLI calls) do not send an
      // Origin header and should remain usable.
      const normalizedOrigin = origin ? normalizeOrigin(origin) : "";
      if (!normalizedOrigin || allowedOrigins.has(normalizedOrigin) || isLocalDevelopmentOrigin(normalizedOrigin)) return callback(null, true);
      const error = new Error("Origin is not allowed by CORS.");
      error.statusCode = 403;
      return callback(error);
    },
    credentials: true,
  }),
);
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", authRoutes);
app.use("/api/pdf", pdfRoutes);
app.use("/api/user", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/notes", noteRoutes);
app.use("/api/quiz", quizRoutes);
app.use("/api/flashcards", flashCardsRoutes);
app.use("/api/planner", plannerRoutes);

app.get("/", (req, res) => {
  res.send("StudyGenie AI Backend is Running 🚀");
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found." });
});

app.use(errorMiddleware);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
    if (localLlamaManager.config.enabled) {
      try {
        const status = await localLlamaManager.ensureReady();
        console.log(`Local llama.cpp is ${status.status} (${status.model}).`);
      } catch (error) {
        console.warn(`Local llama.cpp is not ready: ${error.message}`);
        console.warn("The backend will remain available; AI requests will report the provider error until llama.cpp becomes ready.");
      }
    }
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup aborted because MongoDB is unavailable.");
    process.exitCode = 1;
  }
};

const shutdown = async (signal) => {
  console.log(`Received ${signal}; stopping local llama.cpp if it is managed by StudyGenie.`);
  await localLlamaManager.stop();
  process.exit(0);
};

process.once("SIGINT", () => { shutdown("SIGINT"); });
process.once("SIGTERM", () => { shutdown("SIGTERM"); });

startServer();
