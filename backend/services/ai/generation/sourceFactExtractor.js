"use strict";

/**
 * Small deterministic fact extractor shared by the live quiz and flashcard
 * routes. It intentionally extracts only relationships written in the PDF;
 * callers may return fewer items instead of filling a deck with vague prompts.
 */

const normalize = (value) => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const cleanSegment = (value) => String(value || "")
  .replace(/\s+/g, " ")
  .replace(/^[\s\-–—•:;,.]+|[\s:;,.]+$/g, "")
  .trim();

const QUESTION_HEADING = /^\s*(?:#{1,6}\s*)?(?:what|why|when|where|who|which|how)\b/i;
const PROGRAM_COMMAND = /\b(?:write|implement|develop|create)\s+(?:a\s+)?program\b/i;
const UI_OR_QUESTION_PAPER_NOISE = /\b(?:flipmark|learned|card\s*\d+|easy|medium|hard|question)\b|^\s*#{1,6}\s*/i;

const splitSentences = (content) => String(content || "")
  .replace(/\s+/g, " ")
  .split(/(?<=[.!?])\s+/)
  .map((sentence) => sentence.trim())
  .filter((sentence) => sentence.length >= 25 && sentence.length <= 420);

const isUsableTerm = (term) => {
  const clean = cleanSegment(term);
  const words = clean.split(/\s+/).filter(Boolean);
  return (
    clean.length >= 2
    && clean.length <= 80
    && words.length <= 10
    && !QUESTION_HEADING.test(clean)
    && !PROGRAM_COMMAND.test(clean)
    && !UI_OR_QUESTION_PAPER_NOISE.test(clean)
  );
};

const displayTerm = (term) => String(term || "").replace(/^(A|An|The)\b/, (article) =>
  article.toLowerCase(),
);

const baseVerb = (verb) => {
  const normalized = String(verb || "").toLowerCase();
  const irregular = { has: "have" };
  if (irregular[normalized]) return irregular[normalized];
  return normalized.endsWith("s") ? normalized.slice(0, -1) : normalized;
};

const hasEmbeddedDefinition = (term) =>
  /\b(?:is|are|means|refers to|defined as)\b/i.test(String(term || ""));

const makeFact = ({ term, answer, question, statement, kind }) => {
  const cleanTerm = cleanSegment(term);
  const cleanAnswer = cleanSegment(answer);

  if (!isUsableTerm(cleanTerm) || cleanAnswer.length < 8 || cleanAnswer.length > 320) {
    return null;
  }

  return {
    term: cleanTerm,
    answer: cleanAnswer,
    question,
    statement: String(statement || "").trim(),
    kind,
  };
};

const extractFactFromSentence = (sentence) => {
  const statement = String(sentence || "").trim();
  const withoutTerminal = statement.replace(/[.!?]+$/, "").trim();
  let match;

  // Flashcards must be built from declarative source facts, never from a
  // question-paper prompt or leftover UI text extracted from a PDF/export.
  if (
    statement.includes("?")
    || QUESTION_HEADING.test(withoutTerminal)
    || PROGRAM_COMMAND.test(withoutTerminal)
    || UI_OR_QUESTION_PAPER_NOISE.test(withoutTerminal)
  ) {
    return null;
  }

  // PDF extraction occasionally contains meta prose about the document itself.
  // It is not a study concept, even if it happens to match a relation verb.
  if (
    /^(?:this|the)\s+(?:sentence|text|document|material)\b/i.test(withoutTerminal)
    || /\b(?:no explicit teachable|should not become)\b/i.test(withoutTerminal)
  ) {
    return null;
  }

  // Purpose sentences need to be checked before a generic "is" definition.
  match = withoutTerminal.match(/^(.{2,80}?)\s+(is|are)\s+used\s+(to|for)\s+(.{8,320})$/i);
  if (match && !hasEmbeddedDefinition(match[1])) {
    const [, term, beVerb, preposition, purpose] = match;
    return makeFact({
      term,
      answer: `used ${preposition.toLowerCase()} ${purpose}`,
      question: `What ${beVerb.toLowerCase()} ${displayTerm(cleanSegment(term))} used for?`,
      statement,
      kind: "purpose",
    });
  }

  match = withoutTerminal.match(/^(.{2,80}?)\s+(consists of|includes|contains|has)\s+(.{8,320})$/i);
  if (match && !hasEmbeddedDefinition(match[1])) {
    const [, term, verb, detail] = match;
    const questionVerb = verb.toLowerCase() === "consists of"
      ? "consist of"
      : baseVerb(verb);
    return makeFact({
      term,
      answer: detail,
      question: `What does ${displayTerm(cleanSegment(term))} ${questionVerb}?`,
      statement,
      kind: "composition",
    });
  }

  match = withoutTerminal.match(/^(.{2,80}?)\s+(allows?|enables?|helps?|provides?|performs?|stores?|controls?|manages?|converts?|transforms?|produces?|causes?|supports?|requires?|involves?|follows?|combines?)\s+(.{8,320})$/i);
  if (match && !hasEmbeddedDefinition(match[1])) {
    const [, term, verb, detail] = match;
    return makeFact({
      term,
      answer: detail,
      question: `According to the study material, what does ${displayTerm(cleanSegment(term))} ${baseVerb(verb)}?`,
      statement,
      kind: "relationship",
    });
  }

  match = withoutTerminal.match(/^(.{2,80}?)\s+(is defined as|refers to|means|is|are)\s+(.{8,320})$/i);
  if (match) {
    const [, term, verb, definition] = match;
    const cleanTerm = cleanSegment(term);
    const beVerb = verb.toLowerCase() === "are" ? "are" : "is";
    return makeFact({
      term: cleanTerm,
      answer: definition,
      question: `What ${beVerb} ${displayTerm(cleanTerm)}?`,
      statement,
      kind: "definition",
    });
  }

  return null;
};

const extractSourceFacts = (content) => {
  const seen = new Set();

  return splitSentences(content)
    .map(extractFactFromSentence)
    .filter(Boolean)
    .filter((fact) => {
      const key = `${normalize(fact.term)}|${normalize(fact.answer)}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const selectDistributed = (items, requestedCount) => {
  const target = Math.min(Math.max(Number(requestedCount) || 0, 0), items.length);
  if (!target) return [];
  if (target === items.length) return [...items];
  if (target === 1) return [items[Math.floor(items.length / 2)]];

  const selected = [];
  const used = new Set();

  for (let index = 0; index < target; index += 1) {
    const position = Math.round((index * (items.length - 1)) / (target - 1));
    if (!used.has(position)) {
      selected.push(items[position]);
      used.add(position);
    }
  }

  // Rounding may collide for unusually small lists. Fill deterministically.
  for (let index = 0; index < items.length && selected.length < target; index += 1) {
    if (!used.has(index)) {
      selected.push(items[index]);
      used.add(index);
    }
  }

  return selected;
};

module.exports = {
  normalize,
  extractSourceFacts,
  selectDistributed,
};
