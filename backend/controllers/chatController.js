const ragService = require("../services/ragService");
const chatService = require("../services/chatService");

const SUPPORTED_LLM_PROVIDERS = ["local", "openrouter", "groq"];

const chat = async (req, res, next) => {
  try {
    const { question, pdfId, questionType, llmProvider } = req.body;

    if (typeof question !== "string" || !question.trim()) {
      return res.status(400).json({
        success: false,
        message: "Question is required",
      });
    }

    if (question.length > 4000) {
      return res.status(413).json({
        success: false,
        message: "Question is too long. Please keep it under 4,000 characters.",
      });
    }

    // Optional exam-answer mode (§8). Whitelisted to a known value so an
    // untrusted client can never influence the Python invocation beyond
    // selecting the one supported structured mode.
    const normalizedType =
      typeof questionType === "string" &&
      ["10_mark", "10-mark", "ten_mark", "10mark"].includes(
        questionType.trim().toLowerCase(),
      )
        ? "10_mark"
        : undefined;

    // LLM provider selection: whitelisted to prevent arbitrary provider injection.
    const normalizedProvider =
      typeof llmProvider === "string" &&
      SUPPORTED_LLM_PROVIDERS.includes(llmProvider.trim().toLowerCase())
        ? llmProvider.trim().toLowerCase()
        : undefined;

    const requestedPdfId =
      typeof pdfId === "string" && pdfId.trim() ? pdfId.trim() : undefined;

    // Greetings do not need retrieval or an LLM. Keep them responsive even
    // when the optional Python/LLM runtime is unavailable.
    const normalizedQuestion = question.trim().toLowerCase().replace(/[!.?,]+$/g, "");
    const isGreeting = /^(hi|hello|hey|hii|good morning|good afternoon|good evening)$/.test(
      normalizedQuestion,
    );
    if (isGreeting) {
      const greetingAnswer = "Hi! I’m your StudyGenie tutor. Ask me anything about your selected study material.";
      await chatService.saveChat({
        userId: req.user.id,
        pdfId: requestedPdfId,
        question,
        answer: greetingAnswer,
        sources: [],
        relatedConcepts: [],
        confidence: 1,
        retrievalMethod: "greeting",
      });
      return res.status(200).json({
        success: true,
        answer: greetingAnswer,
        mode: "greeting",
        llm_used: false,
        llm_provider: "local",
        llm_model: null,
        rag_supported: false,
        rag_complete: false,
        sources: [],
        is_from_pdf: false,
        confidence: 1,
        pdfId: requestedPdfId || null,
        retrievalMethod: "greeting",
        questionType: null,
      });
    }

    const conversationHistory = requestedPdfId
      ? await chatService.getRecentDocumentContext(
          req.user.id,
          requestedPdfId,
        )
      : [];

    const result = await ragService.answerQuestion({
      question: question.trim(),
      userId: req.user.id,
      pdfId: requestedPdfId,
      questionType: normalizedType,
      llmProvider: normalizedProvider,
      conversationHistory,
    });

    await chatService.saveChat({
      userId: req.user.id,
      pdfId: result.pdfId,
      question,
      answer: result.answer,
      sources: result.sources,
      relatedConcepts: result.relatedConcepts || [],
      confidence: result.confidence ?? null,
      retrievalMethod: result.retrievalMethod || "unknown",
    });

    res.status(200).json({
      success: true,
      answer: result.answer,
      mode: result.mode || "llm",
      llm_used: result.llm_used === true,
      llm_provider: result.llm_provider || "local",
      llm_model: result.llm_model || "Qwen 3.5",
      rag_supported: result.rag_supported === true,
      rag_complete: result.rag_complete === true,
      sources: result.sources,
      is_from_pdf: result.is_from_pdf === true,
      confidence: result.confidence ?? null,
      pdfId: result.pdfId || null,
      retrievalMethod: result.retrievalMethod || "unknown",
      questionType: result.questionType || null,
    });
  } catch (error) {
    next(error);
  }
};

const getChatHistory = async (req, res, next) => {
  try {
    const history = await chatService.getChatHistory(req.user.id);

    res.status(200).json({
      success: true,
      history,
    });
  } catch (error) {
    next(error);
  }
};

const deleteChatHistory = async (req, res, next) => {
  try {
    const result = await chatService.deleteChatHistory(req.user.id);

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { chat, getChatHistory, deleteChatHistory };
