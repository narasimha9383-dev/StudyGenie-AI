const Flashcard = require("../models/FlashCards");
const { getReadyPdf } = require("./pdfService");

/*
 * AI generator is responsible for:
 * - prompt construction
 * - LLM generation
 * - JSON generation
 * - response parsing
 */
const { FlashcardGenerator } = require("./ai/generation/flashcardGenerator");

/**
 * Create the shared generator once.
 *
 * This avoids creating LLM / prompt / formatter services
 * repeatedly for every flashcard request.
 */
const flashcardGenerator = new FlashcardGenerator();

/**
 * Generate flashcards for a PDF.
 *
 * Flow:
 *
 * Controller
 *     ↓
 * FlashcardService
 *     ↓
 * PDFService
 *     ↓
 * FlashcardGenerator
 *     ↓
 * PromptService
 *     ↓
 * LLMService
 *     ↓
 * ResponseFormatter
 *     ↓
 * MongoDB
 */
const generateFlashcards = async ({
  pdfId,
  userId,
  count = 20,
  regenerate = false,
}) => {
  if (!pdfId) {
    const error = new Error("PDF ID is required.");
    error.statusCode = 400;
    throw error;
  }

  if (!userId) {
    const error = new Error("User ID is required.");
    error.statusCode = 400;
    throw error;
  }

  /*
   * Make sure:
   * - PDF exists
   * - PDF belongs to this user
   * - PDF is ready
   */
  const pdf = await getReadyPdf(pdfId, userId);

  /*
   * Reuse existing flashcards.
   *
   * This prevents generating the same cards repeatedly.
   */
  const existing = await Flashcard.find({
    pdf: pdf._id,
    user: userId,
  }).sort({
    createdAt: -1,
  });

  if (existing.length > 0 && !regenerate) {
    return existing;
  }

  /*
   * PDF text is the source material.
   *
   * AI generation happens inside FlashcardGenerator.
   */
  const content = String(pdf.text || "").trim();

  if (!content) {
    const error = new Error("This PDF does not contain usable text.");

    error.statusCode = 400;

    throw error;
  }

  /*
   * Generate structured flashcards.
   */
  const result = await flashcardGenerator.generate(content, count);

  /*
   * FlashcardGenerator uses ResponseFormatter,
   * so don't blindly assume the response is valid.
   */
  if (!result || result.success !== true) {
    const error = new Error(
      result?.message
        || "This material does not contain enough readable study facts for flashcards. "
          + "Upload text-based notes with definitions or explanations, or OCR a scanned/question-only PDF first.",
    );

    // Insufficient source facts are an expected material-validation outcome,
    // not a server outage. Returning 422 keeps the useful message visible in
    // the Quiz/Flashcards UI instead of replacing it with a generic 500 text.
    error.statusCode = 422;

    throw error;
  }

  const generatedCards = Array.isArray(result.data)
    ? result.data
    : Array.isArray(result.cards)
      ? result.cards
      : [];

  if (!generatedCards.length) {
    const error = new Error("No flashcards were generated.");

    error.statusCode = 502;

    throw error;
  }

  /*
   * Convert AI output into MongoDB documents.
   */
  const documents = generatedCards.map((card) => ({
    user: userId,
    pdf: pdf._id,

    question: String(card.question || "").trim(),

    answer: String(card.answer || "").trim(),

    difficulty: card.difficulty || "Medium",

    isLearned: false,
  }));

  /*
   * Remove malformed cards before inserting.
   */
  const validDocuments = documents.filter(
    (card) => card.question && card.answer,
  );

  if (!validDocuments.length) {
    const error = new Error("Generated flashcards were invalid.");

    error.statusCode = 502;

    throw error;
  }

  // A user-requested regeneration replaces an older automatically generated
  // deck only after a new source-grounded deck has been validated. That avoids
  // leaving stale, low-quality cards in place while also preserving the old
  // deck if generation fails.
  if (regenerate && existing.length) {
    await Flashcard.deleteMany({
      _id: { $in: existing.map((card) => card._id) },
      user: userId,
      pdf: pdf._id,
    });
  }

  /*
   * Store all cards in one MongoDB operation.
   */
  const cards = await Flashcard.insertMany(validDocuments);

  return cards;
};

/**
 * Get all flashcards belonging to a PDF
 * and the authenticated user.
 */
const getFlashcards = async (pdfId, userId) => {
  if (!pdfId) {
    const error = new Error("PDF ID is required.");

    error.statusCode = 400;

    throw error;
  }

  if (!userId) {
    const error = new Error("User ID is required.");

    error.statusCode = 400;

    throw error;
  }

  return Flashcard.find({
    pdf: pdfId,
    user: userId,
  })
    .sort({
      createdAt: -1,
    })
    .lean();
};

/**
 * Update a flashcard.
 *
 * Only explicitly allowed fields can be modified.
 */
const updateFlashcard = async (flashcardId, userId, payload = {}) => {
  if (!flashcardId) {
    const error = new Error("Flashcard ID is required.");

    error.statusCode = 400;

    throw error;
  }

  if (!userId) {
    const error = new Error("User ID is required.");

    error.statusCode = 400;

    throw error;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const error = new Error("Invalid flashcard update data.");

    error.statusCode = 400;

    throw error;
  }

  /*
   * Never allow arbitrary fields from the client
   * to reach MongoDB.
   */
  const allowedFields = new Set([
    "question",
    "answer",
    "difficulty",
    "isLearned",
  ]);

  const update = {};

  for (const [key, value] of Object.entries(payload)) {
    if (allowedFields.has(key)) {
      update[key] = value;
    }
  }

  if (Object.keys(update).length === 0) {
    const error = new Error("No valid fields provided for update.");

    error.statusCode = 400;

    throw error;
  }

  const card = await Flashcard.findOneAndUpdate(
    {
      _id: flashcardId,
      user: userId,
    },
    {
      $set: update,
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!card) {
    const error = new Error("Flashcard not found.");

    error.statusCode = 404;

    throw error;
  }

  return card;
};

/**
 * Delete one flashcard belonging to
 * the authenticated user.
 */
const deleteFlashcard = async (flashcardId, userId) => {
  if (!flashcardId) {
    const error = new Error("Flashcard ID is required.");

    error.statusCode = 400;

    throw error;
  }

  if (!userId) {
    const error = new Error("User ID is required.");

    error.statusCode = 400;

    throw error;
  }

  const card = await Flashcard.findOneAndDelete({
    _id: flashcardId,
    user: userId,
  });

  if (!card) {
    const error = new Error("Flashcard not found.");

    error.statusCode = 404;

    throw error;
  }

  return {
    message: "Flashcard deleted successfully.",
  };
};

module.exports = {
  generateFlashcards,
  getFlashcards,
  updateFlashcard,
  deleteFlashcard,
};
