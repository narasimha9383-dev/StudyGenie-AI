const noteService = require("../services/notesService");
const pdfService = require("../services/pdfService");
const Note = require("../models/Note");
const fs = require("fs");

// Generate notes from uploaded study material
const generateNotes = async (req, res, next) => {
  try {
    const { pdfId } = req.body;

    if (!pdfId) {
      return res.status(400).json({
        success: false,
        message: "PDF ID is required",
      });
    }

    const notes = await noteService.generateNotes(pdfId, req.user.id);

    res.status(200).json({
      success: true,
      notes,
    });
  } catch (error) {
    next(error);
  }
};

// Get previously generated notes
const getNotes = async (req, res, next) => {
  try {
    const { pdfId } = req.params;

    const notes = await noteService.getNotes(pdfId, req.user.id);

    res.status(200).json({
      success: true,
      notes,
    });
  } catch (error) {
    next(error);
  }
};

const listGeneratedNotes = async (req, res, next) => {
  try {
    const notes = await noteService.listGeneratedNotes(req.user.id);
    res.status(200).json({ success: true, notes });
  } catch (error) {
    next(error);
  }
};

const generateQuestionAnswerPdf = async (req, res, next) => {
  try {
    const { rawPdfId, questionPdfId, questionText = "", generationType = "qa", count } = req.body;
    if (!["notes", "qa", "quiz", "10_mark"].includes(generationType)) return res.status(400).json({ success: false, message: "Invalid generation type." });
    // Requested Q&A count (§15). Parsed here but NOT floored — the Python side owns
    // the min-20 rule (§3). An absent/invalid value stays undefined so the default applies.
    const parsedCount = Number.parseInt(count, 10);
    const requestedCount = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : undefined;
    if (!rawPdfId) return res.status(400).json({ success: false, message: "A Raw Context PDF is required." });
    if (typeof questionText !== "string" || questionText.length > 20000) return res.status(400).json({ success: false, message: "Question text is too long." });
    // A 10-mark answer is question-driven: it must have a question to answer, and
    // it does not accept a Question Source PDF or images (they are ignored below).
    if (generationType === "10_mark" && !questionText.trim()) return res.status(400).json({ success: false, message: "A question is required for a 10-mark answer." });
    const title = generationType === "quiz" ? "StudyGenie AI Quiz" : generationType === "notes" ? "StudyGenie AI Study Notes" : generationType === "10_mark" ? "StudyGenie AI Exam Answer (10 Marks)" : "StudyGenie AI Questions & Answers";
    const imageFiles = Array.isArray(req.files) ? req.files : [];
    const questionInputs = [
      { type: "text", value: questionText.trim() },
      ...imageFiles.map((file) => ({ type: "image", file: file.originalname })),
    ].filter((item) => item.value || item.file);
    const note = await Note.create({ user: req.user.id, pdf: rawPdfId, rawPdf: rawPdfId, questionPdf: questionPdfId || undefined, generationType, questionInputs, title, content: "Generation is in progress.", downloadUrl: "/api/notes/GENERATED_ID/download", status: "processing" });
    note.downloadUrl = `/api/notes/${note._id}/download`;
    await note.save();
    const questionImages = imageFiles.map((file) => `data:${file.mimetype};base64,${file.buffer.toString("base64")}`);
    // 10-mark answers retrieve straight from the raw PDF via RAG (§8); the other
    // modes keep the existing question-bank generator. Same completion/failure
    // handling for both so the async Note-job contract (§14) is unchanged.
    const generationPromise = generationType === "10_mark"
      ? pdfService.generateExamAnswerPdf({ rawPdfId, questionText, userId: req.user.id })
      : pdfService.generateQuestionAnswerPdf({
        rawPdfId, questionPdfId, questionImages, questionText, generationType,
        userId: req.user.id, count: requestedCount,
        onProgress: ({ completed, total }) => Note.updateOne(
          { _id: note._id, user: req.user.id },
          { $set: { processing: { stage: "answer_generation", completed, total, percent: total ? Math.round((completed / total) * 100) : 0 } } },
        ),
      });
    generationPromise.then(async (generated) => {
      const questions = generated.questions || [];
      await Note.updateOne({ _id: note._id, user: req.user.id }, { $set: { content: generated.content, pdfPath: generated.filePath, status: "completed", error: undefined, generatedNotes: generated.notes || {}, questions, sourcePages: generated.sourcePages || [], processing: generated.processing || {} } });
    }).catch(async (error) => {
      await Note.updateOne({ _id: note._id, user: req.user.id }, { $set: { status: "failed", error: { code: error.code || "GENERATION_FAILED", message: String(error.message || "AI generation failed.").slice(0, 500) } } });
      console.error(JSON.stringify({ service: "studygenie-ai", event: "notes_generation_failed", noteId: String(note._id), message: error.message }));
    });
    res.status(202).json({ success: true, status: "processing", noteId: note._id, downloadUrl: note.downloadUrl, createdAt: note.createdAt });
  } catch (error) { next(error); }
};

const getGenerationStatus = async (req, res, next) => {
  try {
    const note = await Note.findOne({ _id: req.params.noteId, user: req.user.id }).select("status error downloadUrl createdAt title content generatedNotes questions sourcePages processing").lean();
    if (!note) return res.status(404).json({ success: false, message: "Generated study material not found." });
    res.json({ success: note.status !== "failed", noteId: note._id, status: note.status, error: note.error || null, content: note.status === "completed" ? note.content : null, notes: note.status === "completed" ? note.generatedNotes : null, questions: note.status === "completed" ? note.questions : [], sourcePages: note.status === "completed" ? note.sourcePages : [], processing: note.processing || null, downloadUrl: note.status === "completed" ? note.downloadUrl : null, createdAt: note.createdAt });
  } catch (error) { next(error); }
};

const downloadGeneratedPdf = async (req, res, next) => {
  try {
    const note = await Note.findOne({ _id: req.params.noteId, user: req.user.id }).select("pdfPath title");
    if (!note || !note.pdfPath || !fs.existsSync(note.pdfPath)) return res.status(404).json({ success: false, message: "Generated PDF not found." });
    res.download(note.pdfPath, `${String(note.title || "studygenie-notes").replace(/[^a-z0-9_-]+/gi, "-")}.pdf`);
  } catch (error) { next(error); }
};

const deleteNote = async (req, res, next) => {
  try {
    const result = await noteService.deleteNote(req.params.noteId, req.user.id);

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  generateNotes,
  getNotes,
  listGeneratedNotes,
  generateQuestionAnswerPdf,
  getGenerationStatus,
  downloadGeneratedPdf,
  deleteNote,
};
