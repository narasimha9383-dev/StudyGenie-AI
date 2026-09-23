const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FlashcardGenerator,
} = require("../services/ai/generation/flashcardGenerator");

test("generates natural definition questions from study sentences", async () => {
  const generator = new FlashcardGenerator();

  const result = await generator.generate(
    [
      "Photosynthesis is the process by which plants convert sunlight into chemical energy.",
      "Mitochondria are organelles that generate energy for the cell.",
      "A variable is a container used to store data in memory.",
    ].join(" "),
    3,
  );

  assert.equal(result.success, true);
  assert.equal(result.data.length, 3);
  assert.ok(
    result.data.some((card) => /What is photosynthesis\?/i.test(card.question)),
    "should ask a natural definition question for photosynthesis",
  );
  assert.ok(
    result.data.some((card) => /What are mitochondria\?/i.test(card.question)),
    "should use a plural question for mitochondria",
  );
  assert.ok(
    result.data.some((card) => /What is a variable\?/i.test(card.question)),
    "should preserve articles for singular nouns",
  );
  assert.ok(
    !result.data.some((card) =>
      /Explain the following concept/i.test(card.question),
    ),
    "should avoid vague concept prompts when a definition is available",
  );
});

test("uses explicit relationships and omits vague free-form sentences", async () => {
  const generator = new FlashcardGenerator();
  const source = [
    "A compiler converts source code into machine code.",
    "A linker combines object files into an executable program.",
    "This sentence has no explicit teachable relationship and should not become a card.",
  ].join(" ");

  const result = await generator.generate(source, 10);
  assert.equal(result.success, true);
  assert.equal(result.data.length, 2);
  assert.ok(result.data.some((card) => /what does a compiler convert/i.test(card.question)));
  assert.ok(result.data.every((card) => source.includes(card.answer)));
  assert.ok(!result.data.some((card) => /this sentence has no explicit/i.test(card.question)));
});

test("rejects question-paper prompts and UI fragments instead of making nonsense cards", async () => {
  const generator = new FlashcardGenerator();
  const source = [
    "## What is What? FlipMark learned Card 2 Easy Question.",
    "## What are Why? FlipMark learned Card 3 Easy Question.",
    "Write a program to check whether a number is prime.",
    "A compiler converts source code into machine code.",
  ].join(" ");

  const result = await generator.generate(source, 10);
  assert.equal(result.success, true);
  assert.equal(result.data.length, 1);
  assert.match(result.data[0].question, /what does a compiler convert/i);
  assert.doesNotMatch(result.data[0].question, /what (?:is|are) (?:what|why)/i);
  assert.doesNotMatch(result.data[0].question, /write a program/i);
});
