const { createSemanticChunks } = require("../chunking/chunkService");
const { buildVectorIndex } = require("../vectordb/vectorStore");
const { buildKnowledgeGraph } = require("../knowledge_graph/knowledgeGraphService");

const STAGES = ["Reading PDF", "Understanding Structure", "Creating Semantic Chunks", "Building Embeddings", "Indexing Vector Database", "Analyzing Concepts", "Generating Notes", "Creating Flashcards", "Preparing Quiz", "Finding Videos", "Building Study Plan"];
const initialStages = () => STAGES.map((name) => ({ name, status: "pending" }));

const runAiPipeline = async ({ text, pages = null, figures = [], source = "", pdfId, userId, totalPages, analysis, setup, onStage }) => {
  const stages = initialStages();
  const mark = async (name, status = "completed", detail = {}) => {
    const stage = stages.find((item) => item.name === name);
    if (stage) Object.assign(stage, { status, updatedAt: new Date(), ...detail });
    if (onStage) await onStage(stages);
  };
  await mark("Reading PDF", "processing");
  await mark("Reading PDF");
  await mark("Understanding Structure", "processing");
  await mark("Understanding Structure");
  await mark("Creating Semantic Chunks", "processing");
  const chunks = createSemanticChunks(text, { pdfId, userId, totalPages, pages, figures, source });
  await mark("Creating Semantic Chunks", "completed", { count: chunks.length });
  await mark("Building Embeddings", "processing");
  const semanticIndex = buildVectorIndex(chunks);
  await mark("Building Embeddings", "completed", { provider: semanticIndex.provider, dimension: semanticIndex.dimension });
  await mark("Indexing Vector Database", "processing");
  await mark("Indexing Vector Database", "completed", { indexedChunks: chunks.length });
  await mark("Analyzing Concepts", "processing");
  const knowledgeGraph = buildKnowledgeGraph(analysis);
  await mark("Analyzing Concepts");
  await mark("Generating Notes", setup?.outputTypes?.some((item) => ["Smart Notes", "Handwritten Notes", "Revision Notes"].includes(item)) ? "ready" : "skipped");
  await mark("Creating Flashcards", setup?.outputTypes?.includes("Flashcards") ? "ready" : "skipped");
  await mark("Preparing Quiz", setup?.outputTypes?.includes("Quiz") ? "ready" : "skipped");
  await mark("Finding Videos", setup?.outputTypes?.includes("Video Recommendations") ? "ready" : "skipped");
  await mark("Building Study Plan", "ready");
  return { stages, semanticIndex, knowledgeGraph, pipeline: { version: "studygenie-orchestrator-v1", provider: semanticIndex.provider, personalizedGoal: setup?.goal || "Concept Learning", generatedAt: new Date() } };
};

module.exports = { STAGES, initialStages, runAiPipeline };
