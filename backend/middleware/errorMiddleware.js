const errorMiddleware = (err, req, res, next) => {
  const statusCode = Number.isInteger(err.statusCode)
    ? err.statusCode
    : Number.isInteger(err.status)
      ? err.status
      : 500;

  if (statusCode >= 500) {
    console.error(err.stack || err.message);
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ success: false, message: "Request body contains invalid JSON." });
  }

  if (err.type === "entity.too.large") {
    return res.status(413).json({ success: false, message: "Request body is too large." });
  }

  if (err.name === "ValidationError") {
    return res.status(400).json({ success: false, message: "Request validation failed." });
  }

  if (err.name === "MulterError") {
    return res.status(400).json({ success: false, message: `Upload failed: ${err.message}` });
  }

  if (err.name === "CastError") {
    return res.status(400).json({ success: false, message: "Invalid resource id." });
  }

  if (err.code === 11000) {
    return res.status(409).json({ success: false, message: "A record with that value already exists." });
  }

  res.status(statusCode).json({
    success: false,
    message: statusCode < 500 || err.expose === true
      ? err.message
      : "Something went wrong. Please try again.",
  });
};

module.exports = errorMiddleware;
