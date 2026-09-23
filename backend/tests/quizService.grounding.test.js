const test = require("node:test");
const assert = require("node:assert/strict");

const { buildGroundedQuestions } = require("../services/quizService");

test("creates only source-derived quiz options and never pads short material", () => {
  const source = [
    "Photosynthesis is the process by which plants convert light energy into chemical energy.",
    "Respiration is the process that releases energy from food molecules.",
    "Chlorophyll is the pigment that absorbs light for photosynthesis.",
    "Mitochondria are organelles where cellular respiration occurs.",
  ].join(" ");

  const questions = buildGroundedQuestions(source, 10);
  assert.equal(questions.length, 4);
  for (const item of questions) {
    assert.equal(item.options.length, 4);
    assert.ok(item.options.includes(item.answer));
    assert.equal(new Set(item.options).size, 4);
    for (const option of item.options) assert.ok(source.includes(option));
  }

  assert.deepEqual(buildGroundedQuestions("Only one term is defined here.", 5), []);
});

test("uses fact-specific questions and source explanations", () => {
  const source = [
    "A compiler converts source code into machine code.",
    "A linker combines object files into an executable program.",
    "A debugger helps developers locate program errors.",
    "A repository contains a project's version history.",
  ].join(" ");

  const questions = buildGroundedQuestions(source, 4);
  assert.equal(questions.length, 4);
  assert.ok(questions.some((item) => /what does a compiler convert/i.test(item.question)));

  for (const item of questions) {
    assert.equal(/which statement defines/i.test(item.question), false);
    assert.ok(source.includes(item.explanation));
    assert.ok(source.includes(item.answer));
    for (const option of item.options) assert.ok(source.includes(option));
  }
});

test("rejects question-paper and UI fragments rather than turning them into a quiz", () => {
  const invalidSource = [
    "## What is What? FlipMark learned Card 2 Easy Question.",
    "## What are Why? FlipMark learned Card 3 Easy Question.",
    "Write a program to check whether a number is prime.",
    "Write a program to check whether two Strings are equal.",
  ].join(" ");

  assert.deepEqual(buildGroundedQuestions(invalidSource, 5), []);
});
