"use strict";

/**
 * Heuristic flashcard generator.
 *
 * Mirrors the approach used by quizService: flashcards are derived
 * deterministically from the PDF's own text, so the output is always
 * grounded in the source material (no hallucination, no network, no LLM).
 *
 * Contract expected by services/flashcardService.js:
 *
 *   const generator = new FlashcardGenerator();
 *   const result = await generator.generate(content, count);
 *   // result === { success: true, data: [ { question, answer, difficulty } ] }
 *   // or         { success: false, message: "..." }
 *
 * This module deliberately has:
 *   - no database access
 *   - no network access
 *   - no LLM access
 */

const {
  normalize,
  extractSourceFacts,
  selectDistributed,
} = require("./sourceFactExtractor");

const difficultyFor = (fact) => {
  if (fact.kind === "definition") return "Easy";
  if (fact.kind === "purpose" || fact.kind === "composition") return "Medium";
  return "Hard";
};

class FlashcardGenerator {
  /**
   * Generate up to `count` distinct flashcards from `content`.
   *
   * Fewer than `count` cards may be returned when the document does not
   * contain enough usable sentences — duplicates are never fabricated.
   */
  async generate(content, count = 20) {
    const target = Math.min(Math.max(1, Number(count) || 20), 50);
    const facts = extractSourceFacts(content);

    if (!facts.length) {
      return {
        success: false,
        message:
          "This material does not contain enough readable study facts for flashcards. "
          + "Upload text-based notes with definitions or explanations, or OCR a scanned/question-only PDF first.",
      };
    }

    const cards = [];
    const seenQuestions = new Set();
    const seenAnswers = new Set();

    for (const fact of selectDistributed(facts, target)) {
      const card = {
        question: fact.question,
        answer: fact.answer,
        difficulty: difficultyFor(fact),
      };

      const key = normalize(card.question);
      const answerKey = normalize(card.answer);
      if (seenQuestions.has(key) || seenAnswers.has(answerKey)) {
        continue;
      }

      seenQuestions.add(key);
      seenAnswers.add(answerKey);
      cards.push(card);
    }

    if (!cards.length) {
      return {
        success: false,
        message: "No flashcards could be generated from this document.",
      };
    }

    return {
      success: true,
      data: cards,
    };
  }
}

module.exports = { FlashcardGenerator };
