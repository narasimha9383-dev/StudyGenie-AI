const pdfService = require("../services/pdfService");

// Upload PDF
const uploadPdf = async (req, res, next) => {
  try {
    const pdf = await pdfService.uploadPdf(req.user.id, req.file);

    res.status(201).json({
      success: true,
      message: "PDF uploaded successfully",
      status: "uploaded",
      pdfId: pdf._id,
      pdf: pdfService.toPublicPdf(pdf),
    });
  } catch (error) { next(error); }
};

const setupPdf = async (req, res, next) => {
  try {
    const result = await pdfService.setupPdf(req.params.pdfId, req.user.id, req.body);
    res.status(202).json({ success: true, status: "processing", message: "PDF uploaded successfully. AI processing has started.", ...result, pdf: pdfService.toPublicPdf(result.pdf) });
  } catch (error) { next(error); }
};

// Get All PDFs
const getAllPdfs = async (req, res, next) => {
  try {
    const pdfs = await pdfService.getAllPdfs(req.user.id);

    res.json(pdfs);
  } catch (error) { next(error); }
};

// Get PDF By Id
const getPdfById = async (req, res, next) => {
  try {
    const pdf = await pdfService.getPdfById(req.params.pdfId, req.user.id);

    res.json(pdfService.toPublicPdf(pdf));
  } catch (error) { next(error); }
};

const downloadPdf = async (req, res, next) => {
  try {
    const { filePath, fileName } = await pdfService.getPdfDownload(req.params.pdfId, req.user.id);
    res.download(filePath, fileName, { dotfiles: "deny", headers: { "Cache-Control": "private, no-store" } }, (error) => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) { next(error); }
};

const getProcessingStatus = async (req, res, next) => {
  try {
    const status = await pdfService.getProcessingStatus(req.params.pdfId, req.user.id);
    res.json({ success: true, ...status });
  } catch (error) { next(error); }
};

// Delete PDF
const deletePdf = async (req, res, next) => {
  try {
    const result = await pdfService.deletePdf(req.params.pdfId, req.user.id);

    res.json(result);
  } catch (error) { next(error); }
};

module.exports = {
  uploadPdf,
  setupPdf,
  getAllPdfs,
  getPdfById,
  downloadPdf,
  getProcessingStatus,
  deletePdf,
};
