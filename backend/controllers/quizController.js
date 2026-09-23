const quizService = require("../services/quizService");

// Generate quiz from uploaded PDF
const generateQuiz = async (req, res, next) => {
  try {
    const { pdfId, numberOfQuestions, regenerate } = req.body;

    if (!pdfId) {
      return res.status(400).json({
        success: false,
        message: "PDF ID is required",
      });
    }

    const quiz = await quizService.generateQuiz({
      pdfId,
      userId: req.user.id,
      numberOfQuestions,
      regenerate: regenerate === true,
    });

    res.status(200).json({
      success: true,
      quiz,
    });
  } catch (error) {
    next(error);
  }
};

// Get previously generated quiz
const getQuiz = async (req, res, next) => {
  try {
    const { quizId } = req.params;

    const quiz = await quizService.getQuiz(quizId, req.user.id);

    res.status(200).json({
      success: true,
      quiz,
    });
  } catch (error) {
    next(error);
  }
};

const deleteQuiz = async (req, res, next) => {
  try {
    const result = await quizService.deleteQuiz(req.params.quizId, req.user.id);

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

const submitQuiz = async (req, res, next) => {
  try {
    const attempt = await quizService.submitQuiz({
      quizId: req.params.quizId,
      userId: req.user.id,
      answers: req.body?.answers,
    });

    res.status(200).json({ success: true, attempt });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  generateQuiz,
  getQuiz,
  deleteQuiz,
  submitQuiz,
};
