const test = require("node:test");
const assert = require("node:assert/strict");

const { shouldUseOcr } = require("../services/pdfService");

test("OCR fallback is selected only for sparse scanned-PDF text", () => {
  assert.equal(shouldUseOcr("page number 1", 12), true);
  assert.equal(shouldUseOcr("x".repeat(2000), 12), false);
  assert.equal(shouldUseOcr("", 0), false);
});
