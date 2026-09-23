/**
 * Throwaway E2E harness for the Q&A speed measurement (NOT part of the app).
 *
 * Calls pdfService.generateQuestionAnswerPdf exactly as the controller does
 * (noteController.js:82), bypassing only the HTTP layer + JWT. This exercises the
 * REAL production render path: Mongo chunk load -> spawn main.py --generate-materials
 * -> per-question RAG 10-mark answers -> pdfkit render -> real .pdf file. The new
 * [PDF-PERF]/[QA]/[NOTES] timing lines are produced by that path.
 *
 * Prints durations + counts + the output PDF path only -- never PDF text/secrets.
 * Run from the backend dir:  node scripts/_run_qa_e2e.js
 * Delete after use.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

// Fixture: "1.GenAI-UNIT-I-M" -- the one doc that is BOTH Chroma-grounded (17 vectors
// in the parent store Node uses) AND rich enough for the min-20 floor (46444 chars,
// 21 pages). The fixture user's own docs are all sparse DSA banks; this GenAI doc is
// embedded under user 6a722ca2..., so we drive the run as that user.
const RAW_PDF_ID = "6a78750d3895f61e00bd7631";
const USER_ID = "6a722ca28c153fd155bd96f0";

(async () => {
  const startedAt = Date.now();

  // Mirror production bootstrap exactly (server.js -> config/db.js).
  const connectDB = require("../config/db");
  await connectDB();
  console.log("[E2E] mongo connected");

  // Preflight: confirm the fixture PDF + its indexed chunks exist before the ~20-min run.
  const PDF = require("../models/PDF");
  const DocumentChunk = require("../models/DocumentChunk");
  const pdf = await PDF.findById(RAW_PDF_ID).lean();
  if (!pdf) throw new Error(`Fixture PDF ${RAW_PDF_ID} not found in Mongo`);
  const chunkCount = await DocumentChunk.countDocuments({ user: USER_ID, pdf: RAW_PDF_ID });
  console.log(`[E2E] pdf found title=${JSON.stringify(pdf.title)} status=${pdf.status} totalPages=${pdf.totalPages} textChars=${(pdf.text || "").length}`);
  console.log(`[E2E] indexed DocumentChunks=${chunkCount}`);
  if (!chunkCount) console.log("[E2E] WARNING: no indexed chunks for this user+pdf; RAG retrieval may be empty.");

  const pdfService = require("../services/pdfService");
  console.log("[E2E] starting generateQuestionAnswerPdf (generationType=qa, count=default -> min-20 floor) ...");
  const genStart = Date.now();
  const result = await pdfService.generateQuestionAnswerPdf({
    rawPdfId: RAW_PDF_ID,
    questionPdfId: undefined,
    questionText: "",
    questionImages: [],
    userId: USER_ID,
    generationType: "qa",
    count: undefined,
  });
  const genMs = Date.now() - genStart;

  const qs = result.questions || [];
  const withAnswer = qs.filter((q) => String(q.answer || "").trim()).length;
  console.log("[E2E] ===== RESULT =====");
  console.log(`[E2E] questions=${qs.length} answers=${withAnswer}`);
  console.log(`[E2E] filePath=${result.filePath}`);
  console.log(`[E2E] sourcePages=${JSON.stringify(result.sourcePages)}`);
  console.log(`[E2E] processing=${JSON.stringify(result.processing)}`);
  console.log(`[E2E] answer_char_lengths=${JSON.stringify(qs.map((q) => String(q.answer || "").length))}`);
  console.log(`[E2E] generate_ms=${genMs} harness_total_ms=${Date.now() - startedAt}`);

  await mongoose.disconnect();
  console.log("[E2E] done");
  process.exit(0);
})().catch(async (e) => {
  console.error(`[E2E] FAILED: ${e && e.stack ? e.stack : e}`);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
