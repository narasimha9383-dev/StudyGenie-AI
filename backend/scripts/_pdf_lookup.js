/**
 * Throwaway Mongo lookup (read-only, NOT part of the app).
 * Joins the Chroma-embedded pdf_ids to their Mongo title / status / text size,
 * so we can pick a fixture that is BOTH Chroma-grounded AND rich enough for >=20 Qs.
 * Prints ids/titles/counts only -- never PDF body text or secrets. Delete after use.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

// Real (non-test) pdf_ids that actually have vectors in the parent Chroma store,
// highest vector-count first (from ai/_chroma_inspect.py).
const EMBEDDED = [
  ["6a81c5e6e6342b704caf6a34", 23],
  ["6a81e047ab2a7860a3ed4eef", 22],
  ["6a78750d3895f61e00bd7631", 17],
  ["6a796744c5063d2ca57bf0c1", 17],
  ["6a7b37b1fca8b2b11eba9545", 17],
  ["6a759d3e6e87af340ae9136f", 6],
  ["6a79779efcbf7d734607564b", 6],
  ["6a79a93e3106d563003b9e8e", 6],
  ["6a7b3be4fca8b2b11eba9558", 6],
  ["6a7607f6ffd333fcffa5932b", 5],
];

(async () => {
  await require("../config/db")();
  const PDF = require("../models/PDF");
  const DocumentChunk = require("../models/DocumentChunk");
  console.log("[LOOKUP] pdf_id | vectors | status | pages | textChars | mongoChunks | user | title");
  for (const [id, vectors] of EMBEDDED) {
    let doc = null;
    try { doc = await PDF.findById(id).lean(); } catch { /* bad id */ }
    if (!doc) { console.log(`[LOOKUP] ${id} | ${vectors} | (not in Mongo)`); continue; }
    const chunks = await DocumentChunk.countDocuments({ pdf: id });
    const chars = (doc.text || "").length;
    console.log(`[LOOKUP] ${id} | ${vectors} | ${doc.status} | ${doc.totalPages} | ${chars} | ${chunks} | ${doc.user} | ${JSON.stringify(doc.title)}`);
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error(`[LOOKUP] FAILED: ${e && e.stack ? e.stack : e}`);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
