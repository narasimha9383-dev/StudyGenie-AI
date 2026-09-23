const { DIMENSION, embedText } = require("../embeddings/embeddingProvider");

const cosineSimilarity = (left, right) => left.reduce((sum, value, index) => sum + value * (right[index] || 0), 0);
const buildVectorIndex = (chunks) => ({ provider: process.env.VECTOR_DB_PROVIDER || "mongo-document-chunks", dimension: DIMENSION, version: "hash-embedding-v1", chunks: chunks.map((chunk) => ({ ...chunk, embedding: embedText(chunk.text) })) });
const searchVectorIndex = (index, query, topK = 5) => {
  if (!index?.chunks?.length) return [];
  const queryVector = embedText(query);
  return index.chunks.map((chunk) => ({ ...chunk, score: cosineSimilarity(queryVector, chunk.embedding || []) })).sort((a, b) => b.score - a.score).slice(0, topK).filter((result) => result.score > 0);
};

module.exports = { buildVectorIndex, searchVectorIndex, cosineSimilarity };
