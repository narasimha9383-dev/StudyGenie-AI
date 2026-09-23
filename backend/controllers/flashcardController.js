const flashcardService = require("../services/flashcardService");

const generateFlashcards = async (req, res, next) => {
  try {
    const flashcards = await flashcardService.generateFlashcards({
      pdfId: req.body.pdfId,
      userId: req.user.id,
      count: req.body.count,
      regenerate: req.body.regenerate === true,
    });

    res.status(200).json({
      success: true,
      flashcards,
    });
  } catch (error) {
    next(error);
  }
};

const getFlashcards = async (req, res, next) => {
  try {
    const flashcards = await flashcardService.getFlashcards(req.params.pdfId, req.user.id);

    res.status(200).json({
      success: true,
      flashcards,
    });
  } catch (error) {
    next(error);
  }
};

const updateFlashcard = async (req, res, next) => {
  try {
    const flashcard = await flashcardService.updateFlashcard(
      req.params.flashcardId,
      req.user.id,
      req.body,
    );

    res.status(200).json({
      success: true,
      flashcard,
    });
  } catch (error) {
    next(error);
  }
};

const deleteFlashcard = async (req, res, next) => {
  try {
    const result = await flashcardService.deleteFlashcard(
      req.params.flashcardId, req.user.id,
    );

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  generateFlashcards,
  getFlashcards,
  updateFlashcard,
  deleteFlashcard,
};
