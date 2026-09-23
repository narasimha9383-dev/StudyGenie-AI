const Chat = require("../models/Chat");

/**
 * Chat Service
 *
 * Responsibilities:
 * - Save AI conversations
 * - Retrieve user chat history
 * - Delete user chat history
 *
 * This service does NOT:
 * - call the LLM
 * - perform RAG
 * - create prompts
 * - handle HTTP requests/responses
 * - perform authentication
 */

/**
 * Save an AI conversation.
 */
const saveChat = async ({
  userId,
  pdfId = null,
  question,
  answer,
  sources = [],
  relatedConcepts = [],
  confidence = null,
  retrievalMethod = null,
}) => {
  if (!userId) {
    throw new Error("User ID is required.");
  }

  if (!question || !String(question).trim()) {
    throw new Error("Question is required.");
  }

  if (!answer || !String(answer).trim()) {
    throw new Error("Answer is required.");
  }

  return Chat.create({
    user: userId,
    pdf: pdfId,

    question: String(question).trim(),
    answer: String(answer).trim(),

    sources: Array.isArray(sources) ? sources : [],

    relatedConcepts: Array.isArray(relatedConcepts) ? relatedConcepts : [],

    confidence: typeof confidence === "number" ? confidence : null,

    retrievalMethod: retrievalMethod ? String(retrievalMethod).trim() : null,
  });
};

/**
 * Get chat history for a user.
 *
 * Newest conversations are returned first.
 */
const getChatHistory = async (userId) => {
  if (!userId) {
    throw new Error("User ID is required.");
  }

  return Chat.find({
    user: userId,
  })
    .sort({
      createdAt: -1,
    })
    .lean();
};

/**
 * Return a short, chronological document-scoped conversation window.
 *
 * This is deliberately separate from getChatHistory(): a tutor follow-up may
 * use prior wording to resolve "that" or "the previous concept", but a chat
 * from another PDF must never influence retrieval or the answer.
 */
const getRecentDocumentContext = async (userId, pdfId, limit = 3) => {
  if (!userId || !pdfId) return [];

  const safeLimit = Math.min(Math.max(Number(limit) || 3, 1), 5);
  const rows = await Chat.find({ user: userId, pdf: pdfId })
    .select({ question: 1, answer: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();

  return rows
    .reverse()
    .map((row) => ({
      question: String(row.question || "").trim().slice(0, 600),
      answer: String(row.answer || "").trim().slice(0, 1200),
    }))
    .filter((row) => row.question && row.answer);
};

/**
 * Delete all chat history belonging to a user.
 */
const deleteChatHistory = async (userId) => {
  if (!userId) {
    throw new Error("User ID is required.");
  }

  const result = await Chat.deleteMany({
    user: userId,
  });

  return {
    message: "Chat history deleted successfully.",
    deletedCount: result.deletedCount || 0,
  };
};

module.exports = {
  saveChat,
  getChatHistory,
  getRecentDocumentContext,
  deleteChatHistory,
};
