"use strict";

/**
 * Build bounded context for document-level AI generation.
 *
 * Used by:
 *   PDF chunks
 *      ↓
 *   bounded context
 *      ↓
 *   PromptService
 *      ↓
 *   LLMService
 *
 * This utility deliberately has:
 *   - no database access
 *   - no LLM access
 *   - no network access
 *   - no application state
 */

const DEFAULT_MAX_CHARS = 8000;
const DEFAULT_MAX_CHUNKS = 12;

const normalizeLimit = (value, fallback, minimum) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(minimum, Math.floor(number));
};

const normalizeChunks = (chunks) => {
  if (!Array.isArray(chunks)) {
    return [];
  }

  return chunks.filter(
    (chunk) =>
      chunk && typeof chunk.text === "string" && chunk.text.trim().length > 0,
  );
};

/**
 * Select representative chunks across the complete document.
 *
 * Example:
 *
 * 100 chunks, maxChunks = 10
 *
 * Instead of:
 *
 * [0,1,2,3,4,5,6,7,8,9]
 *
 * we approximately select:
 *
 * [0,10,20,30,40,50,60,70,80,90]
 */
const selectRepresentativeChunks = (chunks, maxChunks) => {
  if (chunks.length <= maxChunks) {
    return chunks;
  }

  const selected = [];
  const step = chunks.length / maxChunks;

  for (let index = 0; index < maxChunks; index += 1) {
    selected.push(chunks[Math.floor(index * step)]);
  }

  return selected;
};

/**
 * Build bounded document context.
 *
 * @param {Array<{text?: string, metadata?: object}>} chunks
 * @param {{
 *   maxChars?: number,
 *   maxChunks?: number
 * }} options
 *
 * @returns {{
 *   content: string,
 *   chunkCountTotal: number,
 *   chunkCountUsed: number,
 *   contextChars: number,
 *   truncated: boolean
 * }}
 */
const buildBoundedMaterialsContent = (chunks, options = {}) => {
  const maxChars = normalizeLimit(options.maxChars, DEFAULT_MAX_CHARS, 500);

  const maxChunks = normalizeLimit(options.maxChunks, DEFAULT_MAX_CHUNKS, 1);

  const usableChunks = normalizeChunks(chunks);

  const chunkCountTotal = usableChunks.length;

  if (chunkCountTotal === 0) {
    return {
      content: "",
      chunkCountTotal: 0,
      chunkCountUsed: 0,
      contextChars: 0,
      truncated: false,
    };
  }

  const selectedChunks = selectRepresentativeChunks(usableChunks, maxChunks);

  const blocks = [];
  let currentChars = 0;
  let truncated = selectedChunks.length < chunkCountTotal;

  for (const chunk of selectedChunks) {
    const page = chunk.metadata?.page_number ?? chunk.metadata?.page ?? 1;

    const text = chunk.text.trim();

    const prefix = `[PDF Page ${page}]\n`;
    const separator = blocks.length > 0 ? "\n\n" : "";

    const availableChars = maxChars - currentChars - separator.length;

    if (availableChars <= 0) {
      truncated = true;
      break;
    }

    const fullBlock = `${prefix}${text}`;

    let block = fullBlock;

    if (fullBlock.length > availableChars) {
      block = fullBlock.slice(0, availableChars);
      truncated = true;
    }

    blocks.push(block);

    currentChars += separator.length + block.length;

    if (currentChars >= maxChars) {
      truncated = true;
      break;
    }
  }

  const content = blocks.join("\n\n");

  return {
    content,
    chunkCountTotal,
    chunkCountUsed: blocks.length,
    contextChars: content.length,
    truncated,
  };
};

module.exports = {
  buildBoundedMaterialsContent,
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_CHUNKS,
};
