const assert = require("node:assert/strict");
const test = require("node:test");
const { buildBoundedMaterialsContent, DEFAULT_MAX_CHARS, DEFAULT_MAX_CHUNKS } = require("../services/materialsContext");

test("returns an empty, non-truncated result for no usable chunks", () => {
  for (const input of [[], null, undefined, [{ metadata: { page: 1 } }], [{ text: "   " }]]) {
    const r = buildBoundedMaterialsContent(input);
    assert.equal(r.content, "");
    assert.equal(r.chunkCountUsed, 0);
    assert.equal(r.contextChars, 0);
    assert.equal(r.truncated, false);
  }
});

test("small document: keeps every chunk and labels pages", () => {
  const chunks = [
    { text: "Alpha content", metadata: { page_number: 1 } },
    { text: "Beta content", metadata: { page: 2 } },
    { text: "Gamma", metadata: {} }, // missing page -> defaults to 1
  ];
  const r = buildBoundedMaterialsContent(chunks, { maxChars: 8000, maxChunks: 12 });
  assert.equal(r.chunkCountTotal, 3);
  assert.equal(r.chunkCountUsed, 3);
  assert.match(r.content, /\[PDF Page 1\]\nAlpha content/);
  assert.match(r.content, /\[PDF Page 2\]\nBeta content/);
  assert.match(r.content, /\[PDF Page 1\]\nGamma/);
  assert.equal(r.truncated, false);
});

test("long document: samples evenly across the whole document up to maxChunks", () => {
  const chunks = Array.from({ length: 30 }, (_, i) => ({ text: `Chunk number ${i}`, metadata: { page: i + 1 } }));
  const r = buildBoundedMaterialsContent(chunks, { maxChars: 8000, maxChunks: 5 });
  assert.equal(r.chunkCountTotal, 30);
  assert.equal(r.chunkCountUsed, 5);
  // Even sampling (step = 6) must include the first and reach the tail, not just the head.
  assert.match(r.content, /Chunk number 0\b/);
  assert.match(r.content, /Chunk number 24\b/);
  assert.equal(r.truncated, true);
});

test("oversized context: hard-caps total characters and marks truncated", () => {
  const big = "X".repeat(5000);
  const chunks = [
    { text: big, metadata: { page: 1 } },
    { text: big, metadata: { page: 2 } },
    { text: big, metadata: { page: 3 } },
  ];
  const r = buildBoundedMaterialsContent(chunks, { maxChars: 6000, maxChunks: 12 });
  assert.ok(r.contextChars <= 6000, `contextChars ${r.contextChars} must be <= 6000`);
  assert.equal(r.content.length, r.contextChars);
  assert.ok(r.chunkCountUsed < r.chunkCountTotal);
  assert.equal(r.truncated, true);
});

test("enforces a minimum character floor even if a tiny budget is requested", () => {
  const chunks = [{ text: "A".repeat(2000), metadata: { page: 1 } }];
  const r = buildBoundedMaterialsContent(chunks, { maxChars: 10 });
  assert.ok(r.contextChars > 0);
  assert.ok(r.contextChars <= 500); // floor is 500
  assert.equal(r.truncated, true);
});

test("filters out non-string / empty chunks before budgeting", () => {
  const chunks = [
    { text: "   ", metadata: { page: 1 } },
    { text: "Real content", metadata: { page: 2 } },
    { text: "", metadata: { page: 3 } },
    { metadata: { page: 4 } },
    { text: 42 },
  ];
  const r = buildBoundedMaterialsContent(chunks, {});
  assert.equal(r.chunkCountTotal, 1);
  assert.equal(r.chunkCountUsed, 1);
  assert.match(r.content, /\[PDF Page 2\]\nReal content/);
});

test("exposes sane defaults", () => {
  assert.equal(DEFAULT_MAX_CHARS, 8000);
  assert.equal(DEFAULT_MAX_CHUNKS, 12);
});
