const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  isExamHeadingLine,
  stripInlineMarkdown,
  renderExamAnswerPdf,
  renderStudyMaterialPdf,
  normalizeGeneratedContent,
  isUsefulFigureCaption,
  selectRelevantFigures,
} = require("../services/pdfService");

const figure = (overrides = {}) => ({
  figure_id: "figure-1",
  image_path: "C:/figures/figure-1.png",
  page_number: 25,
  pages: [25],
  caption: "",
  nearby_text: "",
  ...overrides,
});

const scopedSelection = (options) =>
  selectRelevantFigures({ userId: "user-1", pdfId: "pdf-1", ...options });

test("figure retrieval accepts a strongly relevant caption and rejects an unrelated figure", () => {
  const selected = scopedSelection({
    question: "Explain the TCP three-way handshake.",
    sourcePages: [25],
    figures: [
      figure({ figure_id: "tcp", caption: "TCP three-way handshake", image_path: "tcp.png" }),
      figure({ figure_id: "db", caption: "Database normalization", image_path: "db.png" }),
    ],
  });
  assert.deepEqual(selected.map((item) => item.figure_id), ["tcp"]);
});

test("figure retrieval caps strong candidates at two and does not pad weak matches", () => {
  const figures = [
    figure({ figure_id: "tcp-1", caption: "TCP three-way handshake", image_path: "1.png" }),
    figure({ figure_id: "tcp-2", caption: "TCP three-way handshake sequence", image_path: "2.png" }),
    figure({ figure_id: "weak", caption: "OSI model", image_path: "3.png" }),
  ];
  const selected = scopedSelection({
    question: "Explain the TCP three-way handshake.",
    sourcePages: [25],
    figures,
  });
  assert.deepEqual(selected.map((item) => item.figure_id), ["tcp-1", "tcp-2"]);
});

test("figure retrieval returns no image when nothing clears the strict threshold", () => {
  const selected = scopedSelection({
    question: "Explain the TCP three-way handshake.",
    sourcePages: [25],
    figures: [figure({ caption: "Database normalization", nearby_text: "Relations and normal forms" })],
  });
  assert.deepEqual(selected, []);
});

test("figure retrieval removes duplicate figure identities", () => {
  const selected = scopedSelection({
    question: "Explain the TCP three-way handshake.",
    sourcePages: [25],
    figures: [
      figure({ figure_id: "same", caption: "TCP three-way handshake", image_path: "1.png" }),
      figure({ figure_id: "same", caption: "TCP three-way handshake", image_path: "1-copy.png" }),
    ],
  });
  assert.equal(selected.length, 1);
});

test("relevant nearby text can select a captionless figure", () => {
  const selected = scopedSelection({
    question: "Explain the TCP three-way handshake.",
    sourcePages: [25],
    figures: [figure({ caption: "", nearby_text: "The TCP three-way handshake establishes a connection." })],
  });
  assert.equal(selected.length, 1);
});

test("page proximity cannot make an unrelated figure pass", () => {
  const selected = scopedSelection({
    question: "Explain the TCP three-way handshake.",
    sourcePages: [25],
    figures: [figure({ caption: "Database normalization", nearby_text: "Functional dependencies and relations" })],
  });
  assert.deepEqual(selected, []);
});

test("figure retrieval fails closed without scope and rejects another PDF", () => {
  const candidate = figure({
    pdf_id: "pdf-2",
    caption: "TCP three-way handshake",
  });
  assert.deepEqual(
    selectRelevantFigures({
      question: "Explain the TCP three-way handshake.",
      sourcePages: [25],
      figures: [candidate],
    }),
    [],
  );
  assert.deepEqual(
    scopedSelection({
      question: "Explain the TCP three-way handshake.",
      sourcePages: [25],
      figures: [candidate],
    }),
    [],
  );
});

test("normalizeGeneratedContent unwraps structured model responses without leaking JSON", () => {
  const cases = [
    ['{"answer":"Detailed answer","key_points":["One","Two"]}', "Detailed answer"],
    ['```json\n{"answer":"Fenced answer"}\n```', "Fenced answer"],
    ['Model output: {"data":{"answer":"Embedded answer"}}', "Embedded answer"],
    [{ data: { response: { answer: "Nested answer" } } }, "Nested answer"],
    ["Plain detailed answer", "Plain detailed answer"],
    ["[{'key_points': ['User Prompt: Initial input.', 'Model Inference: Processes context.', 'Final Output: Delivered to the user.']}]", "User Prompt: Initial input."],
    ['{"answer":"Malformed"', '{"answer":"Malformed"'],
    ["", ""],
  ];
  for (const [input, expected] of cases) {
    const output = normalizeGeneratedContent(input);
    assert.ok(output.includes(expected));
    if (expected !== '{"answer":"Malformed"') assert.doesNotMatch(output, /^\s*[\[{]/);
  }
});

// §8/§13 exam-answer rendering. These exercise the self-contained pieces of the
// 10-mark PDF path (line classification, inline-markdown stripping, and the PDFKit
// renderer) with NO database or Python AI layer — the retrieval/grounding is tested
// on the Python side. The renderer must never fabricate figures or page references
// that the answer/sources did not provide (§9), so the "no references" case matters
// as much as the populated one.

test("isExamHeadingLine detects the heading shapes the model emits", () => {
  for (const line of ["## Introduction", "# Overview", "1. Introduction", "2) Methods", "**Definition**", "**Key Point**:"]) {
    assert.equal(isExamHeadingLine(line), true, `expected heading: ${line}`);
  }
});

test("isExamHeadingLine does NOT treat prose, bullets, or inline bold as headings", () => {
  // A decimal ("1.5 metres") and mid-sentence **bold** must stay body text so the
  // renderer flows them as paragraphs, not section titles.
  for (const line of ["This is a plain sentence.", "- a bullet point", "**bold** appears mid sentence here", "1.5 metres of cable", ""]) {
    assert.equal(isExamHeadingLine(line), false, `expected NOT a heading: ${line}`);
  }
});

test("stripInlineMarkdown removes heading, bold, code, and stray markers", () => {
  assert.equal(stripInlineMarkdown("## Introduction"), "Introduction");
  assert.equal(stripInlineMarkdown("**bold** and `code`"), "bold and code");
  assert.equal(stripInlineMarkdown("*star*"), "star");
  assert.equal(stripInlineMarkdown("plain text"), "plain text");
});

test("figure captions suppress generic broken labels but retain meaningful captions", () => {
  assert.equal(isUsefulFigureCaption("Source figure"), false);
  assert.equal(isUsefulFigureCaption("Diagram"), false);
  assert.equal(isUsefulFigureCaption("GAN architecture"), true);
});

test("renderExamAnswerPdf writes a valid PDF with figure captions and source pages", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sg-exam-"));
  const filePath = path.join(dir, "answer.pdf");
  const answer = [
    "## Introduction",
    "This defines the **core concept** grounded in the uploaded material.",
    "## Key Mechanisms",
    "- First mechanism explained clearly.",
    "- Second mechanism with `terminology`.",
    "## Conclusion",
    "A closing paragraph summarising the answer.",
  ].join("\n");
  const sources = [
    // A real figure caption (§7): shown, never claimed to have been "read".
    { asset_type: "figure", caption: "Three-way handshake overview", page_number: 4 },
    // Non-figure asset: must be ignored by the "Figures referenced" section.
    { asset_type: "text", caption: "plain text chunk", page_number: 2 },
  ];
  try {
    await renderExamAnswerPdf({
      filePath,
      title: "Computer Networks",
      question: "Explain the TCP three-way handshake.",
      answer,
      sources,
      sourcePages: [2, 4],
    });
    const buffer = fs.readFileSync(filePath);
    assert.ok(buffer.length > 500, "PDF should be non-trivial in size");
    assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-", "must be a valid PDF header");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("renderExamAnswerPdf renders cleanly with no sources and no source pages (§9 no fabrication)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sg-exam-"));
  const filePath = path.join(dir, "answer-bare.pdf");
  try {
    await renderExamAnswerPdf({
      filePath,
      title: "Computer Networks",
      question: "Explain congestion control.",
      answer: "Congestion control limits the sending rate to avoid overwhelming the network.",
      sources: [],
      sourcePages: [],
    });
    const buffer = fs.readFileSync(filePath);
    assert.ok(buffer.length > 500, "PDF should still render without any references");
    assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("renderStudyMaterialPdf supports detailed Q&A section ordering", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sg-study-material-"));
  const filePath = path.join(dir, "detailed-qa.pdf");
  try {
    await renderStudyMaterialPdf({
      filePath,
      title: "Source-grounded topic",
      generationType: "qa",
      questions: [{
        question: "What is the source-grounded topic?",
        answer: [
          "1. Definition",
          "The definition is supported by the uploaded material.",
          "2. Point-wise Explanation",
          "- First source-supported point.",
          "- Second source-supported point.",
          "3. Conclusion",
          "The conclusion restates only the supported material.",
        ].join("\n"),
        key_points: ["First source-supported point", "Second source-supported point"],
        source_pages: [1],
        images: [],
      }],
    });
    const buffer = fs.readFileSync(filePath);
    assert.ok(buffer.length > 700, "detailed Q&A PDF should include structured answer content");
    assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
