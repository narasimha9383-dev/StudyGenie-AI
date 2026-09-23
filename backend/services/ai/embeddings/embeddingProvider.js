const crypto = require("crypto");

const DIMENSION = Number(process.env.LOCAL_EMBEDDING_DIMENSION || 96);
const embedText = (text) => {
  const vector = Array.from({ length: DIMENSION }, () => 0);
  const tokens = String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || [];
  for (const token of tokens) {
    const digest = crypto.createHash("sha256").update(token).digest();
    vector[digest.readUInt32BE(0) % DIMENSION] += digest[4] % 2 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
};

module.exports = { DIMENSION, embedText };
