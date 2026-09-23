const crypto = require("crypto");

const sentencePattern = /[^.!?\n]+[.!?]+|[^.!?\n]+$/g;

// ---------------------------------------------------------------------------
// Structure detection (§6 heading-aware, §7 figure/table-aware)
// ---------------------------------------------------------------------------
// Conservative heuristics so ordinary prose is never mistaken for a heading.
// Returns { text, level } for a heading-like line, else null.
const detectHeading = (rawLine) => {
  const line = String(rawLine || "").trim();
  if (!line || line.length > 120) return null;
  // Markdown-style "## Heading".
  const md = line.match(/^(#{1,6})\s+(.*\S)\s*$/);
  if (md) return { text: md[2].trim(), level: md[1].length };
  // Numbered heading: "1 Intro", "1.2 Deadlock", "3.4.5 Recovery".
  const numbered = line.match(/^(\d+(?:\.\d+)*)\.?\s+([A-Za-z].{1,98})$/);
  if (numbered && !/[.!?]$/.test(line)) {
    const depth = numbered[1].split(".").filter(Boolean).length;
    return { text: `${numbered[1]} ${numbered[2].trim()}`, level: Math.min(depth, 6) };
  }
  // Chapter/Unit/Section keyword heading.
  if (/^(chapter|unit|section|part|module|lesson)\b/i.test(line) && line.length <= 100 && !/[.!?]$/.test(line)) {
    return { text: line, level: 1 };
  }
  // Short ALL-CAPS heading (letters dominate, no sentence punctuation).
  if (line === line.toUpperCase() && /[A-Z]/.test(line) && line.replace(/[^A-Za-z]/g, "").length >= 3
      && line.split(/\s+/).length <= 10 && !/[.!?]$/.test(line)) {
    return { text: line, level: 2 };
  }
  return null;
};

// Figure/table caption detection (§7). Returns { kind, id, caption } or null.
// The model is text-only; captions + surrounding text are what ground a
// figure/table answer, so we capture them as first-class metadata.
const detectAsset = (rawLine) => {
  const m = String(rawLine || "").trim().match(/^(figure|fig\.?|table|diagram|chart)\s*([0-9]+(?:\.[0-9]+)?)\b\s*[:.\-–]?\s*(.*)$/i);
  if (!m) return null;
  const kind = /^table/i.test(m[1]) ? "table" : "figure";
  const id = `${kind === "table" ? "Table" : "Figure"} ${m[2]}`;
  const rest = (m[3] || "").trim();
  return { kind, id, caption: rest ? `${id}: ${rest}` : id };
};

// ---------------------------------------------------------------------------
// Semantic chunking
// ---------------------------------------------------------------------------
// Produces retrieval chunks with rich, structure-aware metadata (§3). When a
// per-page `pages` array is supplied (from pdf-parse), `page_number` is EXACT;
// otherwise it falls back to the legacy character-ratio estimate. All previous
// metadata keys (pdfId, userId, charStart, charEnd, page, tokenCount) are kept
// for backward compatibility; new keys are additive.
const createSemanticChunks = (
  text,
  { pdfId, userId, totalPages = 0, pages = null, figures = [], source = "", maxCharacters = 1200, overlap = 160 } = {},
) => {
  const figuresByPage = new Map();
  for (const figure of Array.isArray(figures) ? figures : []) {
    const figurePages = Array.isArray(figure.pages) && figure.pages.length ? figure.pages : [figure.page_number];
    for (const page of figurePages.filter(Number.isFinite)) {
      if (!figuresByPage.has(page)) figuresByPage.set(page, []);
      figuresByPage.get(page).push(figure);
    }
  }
  // Normalise input into ordered { page, text } units. A real per-page array
  // gives accurate page numbers; without it we treat the whole document as one
  // unit and estimate pages from character position (legacy behaviour).
  const pageUnits = Array.isArray(pages) && pages.length
    ? pages
        .map((page, index) => ({
          page: Number.isFinite(page?.page) ? page.page : index + 1,
          text: String(page?.text ?? page ?? "").replace(/\r/g, ""),
        }))
        .filter((unit) => unit.text.trim())
    : (() => {
        const flattened = String(text || "").replace(/\r/g, "").trim();
        return flattened ? [{ page: null, text: flattened }] : [];
      })();

  if (!pageUnits.length) return [];

  const totalLength = Math.max(pageUnits.reduce((sum, unit) => sum + unit.text.length, 0), 1);
  const estimatePage = (offset) => (totalPages ? Math.max(1, Math.ceil((offset / totalLength) * totalPages)) : null);

  const chunks = [];
  let cursor = 0; // global char offset across all pages

  // State carried into the buffer currently being filled.
  let buffer = "";
  let bufferStart = 0;
  let bufferPage = pageUnits[0].page;
  let section = "";
  let sectionLevel = null;
  let subsection = "";
  let bufferSection = "";
  let bufferSubsection = "";
  let bufferLevel = null;
  let bufferAsset = null;

  const resetBuffer = (startOffset, page) => {
    buffer = "";
    bufferStart = startOffset;
    bufferPage = page;
    bufferSection = section;
    bufferSubsection = subsection;
    bufferLevel = sectionLevel;
    bufferAsset = null;
  };

  const flush = () => {
    const body = buffer.trim();
    if (!body) return;
    const index = chunks.length;
    const chunkId = crypto.createHash("sha1").update(`${pdfId}:${index}:${body}`).digest("hex");
    const asset = bufferAsset;
    const pageNumber = bufferPage != null ? bufferPage : estimatePage(bufferStart);
    chunks.push({
      chunkId,
      index,
      text: body,
      metadata: {
        // --- legacy keys (compatibility) ---
        pdfId: String(pdfId),
        userId: String(userId),
        charStart: bufferStart,
        charEnd: bufferStart + body.length,
        page: pageNumber,
        tokenCount: body.split(/\s+/).filter(Boolean).length,
        // --- enriched structure metadata (§3) ---
        document_id: String(pdfId),
        page_number: pageNumber,
        chunk_id: chunkId,
        section: bufferSection || "",
        subsection: bufferSubsection || "",
        parent_section: bufferSection || "",
        heading_level: bufferLevel,
        content_type: asset ? asset.kind : "text",
        source: String(source || ""),
        figure_id: asset && asset.kind === "figure" ? asset.id : "",
        table_id: asset && asset.kind === "table" ? asset.id : "",
        caption: asset ? asset.caption : "",
        images_json: JSON.stringify((figuresByPage.get(pageNumber) || []).map((figure) => ({
          image_id: figure.figure_id,
          image_path: figure.image_path,
          page_number: figure.page_number,
          image_type: figure.figure_kind || "image",
          caption: figure.caption || "",
          bbox: figure.bbox || null,
          width: figure.width,
          height: figure.height,
        }))),
        // previous_chunk_id / next_chunk_id are linked in a second pass below.
      },
    });
  };

  for (const unit of pageUnits) {
    // Lines preserve heading/caption structure; paragraphs+sentences fill bodies.
    const lines = unit.text.split(/\n/);
    let started = false;
    if (!buffer) resetBuffer(cursor, unit.page);
    else bufferPage = bufferPage != null ? bufferPage : unit.page;

    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      const lineLength = rawLine.length + 1; // +1 for the split newline
      if (!line) {
        cursor += lineLength;
        continue;
      }

      const heading = detectHeading(line);
      if (heading) {
        // A heading is a clean section boundary (§6): close the current chunk,
        // update the running section/subsection, and begin a new chunk that
        // opens with the heading text so retrieval keeps heading + body together.
        flush();
        if (heading.level <= 1) {
          section = heading.text;
          sectionLevel = heading.level;
          subsection = "";
        } else {
          subsection = heading.text;
          if (!section) sectionLevel = heading.level;
        }
        resetBuffer(cursor, unit.page);
        buffer = heading.text;
        started = true;
        cursor += lineLength;
        continue;
      }

      const asset = detectAsset(line);
      if (asset && !bufferAsset) bufferAsset = asset;

      // Accumulate prose sentence-by-sentence, flushing on size with overlap.
      const units = line.match(sentencePattern) || [line];
      for (const piece of units) {
        const sentence = piece.trim();
        if (!sentence) continue;
        const candidate = buffer ? `${buffer} ${sentence}` : sentence;
        if (buffer && candidate.length > maxCharacters) {
          flush();
          const tail = buffer.slice(Math.max(0, buffer.length - overlap));
          resetBuffer(Math.max(0, cursor - tail.length), unit.page);
          buffer = `${tail} ${sentence}`.trim();
        } else {
          buffer = candidate;
        }
        started = true;
      }
      cursor += lineLength;
    }
    // Flush at page boundaries so page_number stays accurate per chunk.
    if (started || buffer.trim()) {
      flush();
      resetBuffer(cursor, null);
    }
  }
  flush();

  // Second pass: link neighbours for context expansion (§3, §5 stage 3).
  for (let i = 0; i < chunks.length; i += 1) {
    chunks[i].metadata.previous_chunk_id = i > 0 ? chunks[i - 1].chunkId : "";
    chunks[i].metadata.next_chunk_id = i < chunks.length - 1 ? chunks[i + 1].chunkId : "";
  }

  return chunks;
};

module.exports = { createSemanticChunks, detectHeading, detectAsset };
