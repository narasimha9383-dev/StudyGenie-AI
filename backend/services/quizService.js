const Quiz = require("../models/Quiz");
const { getReadyPdf } = require("./pdfService");
const {
  normalize,
  extractSourceFacts,
  selectDistributed,
} = require("./ai/generation/sourceFactExtractor");

// The live quiz route stays deterministic: question, answer, distractors, and
// explanation each come from a relationship explicitly written in the PDF.
const buildGroundedQuestions = (text, requestedCount) => {
  const candidates = extractSourceFacts(text);
  if (candidates.length < 4) return [];

  const target = Math.min(
    Math.max(Number(requestedCount) || 0, 1),
    candidates.length,
  );
  const questions = [];
  const seen = new Set();

  for (const [index, correct] of selectDistributed(candidates, target).entries()) {
    const options = [correct.answer];
    const origin = candidates.indexOf(correct);

    for (let offset = 1; offset < candidates.length && options.length < 4; offset += 1) {
      const candidate = candidates[(origin + offset) % candidates.length];
      if (!options.some((option) => normalize(option) === normalize(candidate.answer))) {
        options.push(candidate.answer);
      }
    }

    if (options.length !== 4) continue;

    const key = `${normalize(correct.term)}|${normalize(correct.answer)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    questions.push({
      question: correct.question,
      options: options.map((_, optionIndex) =>
        options[(optionIndex + index) % options.length],
      ),
      answer: correct.answer,
      explanation: correct.statement,
    });
  }

  return questions;
};

const generateQuiz = async ({
  pdfId,
  userId,
  numberOfQuestions = 5,
  regenerate = false,
}) => {
  const pdf = await getReadyPdf(pdfId, userId);
  const existing = await Quiz.findOne({ pdf: pdf._id, user: userId }).sort({ createdAt: -1 });
  if (existing?.questions?.length && !regenerate) return existing;
  const count = Math.min(Math.max(Number(numberOfQuestions) || 5, 1), 20);
  const questions = buildGroundedQuestions(pdf.text, count);
  if (!questions.length) {
    const error = new Error(
      "This material does not contain four distinct readable study facts for a grounded quiz. "
      + "Upload text-based notes with definitions or explanations, or OCR a scanned/question-only PDF first.",
    );
    error.statusCode = 422;
    throw error;
  }

  if (existing && regenerate) {
    existing.questions = questions;
    existing.attempts = [];
    await existing.save();
    return existing;
  }

  const quiz = await Quiz.create({
    user: pdf.user,
    pdf: pdf._id,
    questions,
  });

  return quiz;
};

const getQuiz = async (quizId, userId) => {
  const quiz = await Quiz.findOne({ _id: quizId, user: userId });

  if (!quiz) {
    const error = new Error("Quiz not found");
    error.statusCode = 404;
    throw error;
  }

  return quiz;
};

const deleteQuiz = async (quizId, userId) => {
  const quiz = await Quiz.findOneAndDelete({ _id: quizId, user: userId });

  if (!quiz) {
    const error = new Error("Quiz not found");
    error.statusCode = 404;
    throw error;
  }

  return { message: "Quiz deleted successfully" };
};

const submitQuiz = async ({ quizId, userId, answers }) => {
  const quiz = await Quiz.findOne({ _id: quizId, user: userId });

  if (!quiz) {
    const error = new Error("Quiz not found");
    error.statusCode = 404;
    throw error;
  }

  if (!Array.isArray(answers)) {
    const error = new Error("Answers must be an array.");
    error.statusCode = 400;
    throw error;
  }

  const normalizedAnswers = quiz.questions.map((_, index) =>
    String(answers[index] || "").trim(),
  );
  const score = quiz.questions.reduce(
    (total, item, index) => total + (normalizedAnswers[index] === item.answer ? 1 : 0),
    0,
  );
  const total = quiz.questions.length;
  const attempt = {
    answers: normalizedAnswers,
    score,
    total,
    accuracy: total ? Math.round((score / total) * 100) : 0,
    submittedAt: new Date(),
  };

  if (!Array.isArray(quiz.attempts)) quiz.attempts = [];
  quiz.attempts.push(attempt);
  await quiz.save();
  return quiz.attempts[quiz.attempts.length - 1].toObject();
};

module.exports = {
  generateQuiz,
  getQuiz,
  deleteQuiz,
  submitQuiz,
  buildGroundedQuestions,
};
