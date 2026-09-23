const jwt = require("jsonwebtoken");

const generateToken = (id) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET must be configured before issuing tokens.");
  }

  return jwt.sign({ id }, secret, { expiresIn: process.env.JWT_EXPIRES_IN || "30d" });
};

module.exports = generateToken;
