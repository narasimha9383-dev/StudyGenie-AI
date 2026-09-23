"use strict";

const fs = require("fs");

const Note = require("../models/Note");
const { getReadyPdf } = require("./pdfService");
const { buildBoundedMaterialsContent } = require("./materialsContext");
const DocumentChunk = require("../models/DocumentChunk");

const DEFAULT_MAX_CONTEXT_CHARS = 8000;
const DEFAULT_MAX_CONTEXT_CHUNKS = 12;

/**
 * Convert analysis items into readable markdown.
 */
const formatList = (items, fallback = "No items detected") => {
  if (!Array.isArray(items) || items.length === 0) {
    return `- ${fallback}`;
  }

  return items
    .filter(Boolean)
    .map((item) => {
      if (typeof item === "string") {
        return `- ${item}`;
      }

      if (typeof item === "object") {
        return `- ${item.term || item.text || JSON.stringify(item)}`;
      }

      return `- ${String(item)}`;
    })
    .join("\n");
};

/**
 * Safely extract the PDF analysis.
 */
const getAnalysis = (pdf) => {
  return pdf?.metadata?.analysis || {};
};

/**
 * Safely extract the user's learning setup.
 */
const getLearningSetup = (pdf) => {
  return pdf?.metadata?.learningSetup || {};
};

/**
 * Build the notes document from structured PDF analysis
 * plus bounded PDF context.
 */
const buildNotesContent = (pdf, chunks = []) => {
  const analysis = getAnalysis(pdf);
  const setup = getLearningSetup(pdf);

  const concepts = Array.isArray(analysis.concepts)
    ? analysis.concepts.slice(0, 12)
    : [];

  const definitions =
    Array.isArray(analysis.definitions) && analysis.definitions.length
      ? analysis.definitions.slice(0, 8)
      : Array.isArray(analysis.keySentences)
        ? analysis.keySentences.slice(0, 8)
        : [];

  const formulas = Array.isArray(analysis.formulas) ? analysis.formulas : [];

  const algorithms = Array.isArray(analysis.algorithms)
    ? analysis.algorithms
    : [];

  const focusAreas =
    Array.isArray(setup.focusAreas) && setup.focusAreas.length
      ? setup.focusAreas
      : ["Everything"];

  const sourceChunks = Array.isArray(chunks) ? chunks : [];

  const boundedContext = buildBoundedMaterialsContent(sourceChunks, {
    maxChars: DEFAULT_MAX_CONTEXT_CHARS,
    maxChunks: DEFAULT_MAX_CONTEXT_CHUNKS,
  });

  return [
    `# ${pdf.title || "Study Notes"}`,

    "",

    "## Learning Objective",
    `${setup.goal || "Concept learning"} · ${
      setup.level || "Intermediate"
    } · ${setup.explanationStyle || "Like a Teacher"}`,

    "",

    "## Key Concepts",
    formatList(concepts),

    "",

    "## Core Explanations",
    formatList(definitions),

    formulas.length
      ? `\n## Formulas and Theorems\n${formatList(formulas)}`
      : "",

    algorithms.length
      ? `\n## Algorithms and Procedures\n${formatList(algorithms)}`
      : "",

    "",

    "## Revision Focus",
    formatList(focusAreas),

    "",

    "## Source Context",
    boundedContext.content || "- No source context available.",
  ]
    .filter(Boolean)
    .join("\n");
};

/**
 * Generate notes for a PDF.
 *
 * Responsibilities:
 *   1. Validate/access the PDF.
 *   2. Read existing analysis/setup.
 *   3. Build bounded source context.
 *   4. Persist the generated note.
 *
 * This service does NOT:
 *   - call the LLM
 *   - perform vector search
 *   - construct embeddings
 *   - perform web search
 */
const generateNotes = async (pdfId, userId) => {
  const pdf = await getReadyPdf(pdfId, userId);

  const existing = await Note.findOne({
    user: userId,
    pdf: pdf._id,
  });

  if (existing) {
    return existing;
  }

  const chunks = await DocumentChunk.find({
    user: userId,
    pdf: pdf._id,
  })
    .sort({ index: 1 })
    .lean();

  const content = buildNotesContent(pdf, chunks);

  const note = await Note.create({
    user: pdf.user,
    pdf: pdf._id,
    title: `${pdf.title || "Study"} Notes`,
    content,
  });

  return note;
};

/**
 * Get notes belonging to a specific PDF and user.
 */
const getNotes = async (pdfId, userId) => {
  return Note.find({
    pdf: pdfId,
    user: userId,
  }).sort({
    createdAt: -1,
  });
};

/**
 * List generated notes belonging to the signed-in user.
 */
const listGeneratedNotes = async (userId) => {
  return Note.find({
    user: userId,
    pdfPath: {
      $exists: true,
      $ne: "",
    },
    status: "completed",
  })
    .populate({
      path: "pdf",
      select: "title status",
    })
    .sort({
      createdAt: -1,
    })
    .lean();
};

/**
 * Delete a note owned by the signed-in user.
 *
 * File deletion is best-effort because the database record
 * should not remain simply because the generated file is missing.
 */
const deleteNote = async (noteId, userId) => {
  const note = await Note.findOneAndDelete({
    _id: noteId,
    user: userId,
  });

  if (!note) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }

  if (note.pdfPath) {
    await fs.promises.unlink(note.pdfPath).catch(() => undefined);
  }

  return {
    message: "Note deleted successfully",
  };
};

module.exports = {
  generateNotes,
  getNotes,
  listGeneratedNotes,
  deleteNote,
};
