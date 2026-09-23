const assert = require("node:assert/strict");
const test = require("node:test");
const { shouldAutoGenerateMaterials } = require("../services/pdfService");

// RAG-first policy: setup extracts + indexes only. Study material is generated on
// explicit user request unless AUTO_GENERATE_ON_SETUP is enabled. These tests pin
// the pure gate so the decoupling cannot silently regress.

test("does NOT auto-generate when the flag is off, even for a completed study PDF", () => {
  assert.equal(
    shouldAutoGenerateMaterials("completed", { documentRole: "study" }, { autoGenerate: false }),
    false,
  );
});

test("defaults to off (no explicit flag) so upload never auto-generates by default", () => {
  // The module reads AUTO_GENERATE_ON_SETUP at load; the default policy is OFF.
  assert.equal(shouldAutoGenerateMaterials("completed", { documentRole: "study" }), false);
});

test("auto-generates only when enabled AND the document processed successfully", () => {
  assert.equal(shouldAutoGenerateMaterials("completed", {}, { autoGenerate: true }), true);
  assert.equal(shouldAutoGenerateMaterials("processing", {}, { autoGenerate: true }), false);
  assert.equal(shouldAutoGenerateMaterials("failed", {}, { autoGenerate: true }), false);
});

test("never auto-generates for a question-paper source, even when enabled", () => {
  assert.equal(
    shouldAutoGenerateMaterials("completed", { documentRole: "question_source" }, { autoGenerate: true }),
    false,
  );
});
