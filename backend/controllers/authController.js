const authService = require("../services/authService");

// Register User
const registerUser = async (req, res, next) => {
  try {
    const { name, email, password, college, course, year } = req.body || {};
    const result = await authService.registerUser({ name, email, password, college, course, year });

    res.status(201).json({
      message: "User registered successfully",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

// Login User
const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const result = await authService.loginUser({ email, password });

    res.status(200).json({
      message: "Login successful",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

// Logout User
const logoutUser = async (req, res) => {
  res.json({ message: "Logout successful" });
};

const forgotPassword = async (req, res, next) => {
  try {
    const developmentToken = await authService.requestPasswordReset(req.body.email);
    res.status(200).json({ message: "If an account exists for this email, a reset link has been sent.", ...(developmentToken ? { developmentToken } : {}) });
  } catch (error) { next(error); }
};

const resetPassword = async (req, res, next) => {
  try { await authService.resetPassword(req.body); res.status(200).json({ message: "Password updated successfully. Please sign in." }); } catch (error) { next(error); }
};

const googleLogin = async (req, res, next) => {
  try { const result = await authService.loginWithGoogle(req.body?.idToken); res.status(200).json({ message: "Google sign-in successful", ...result }); } catch (error) { next(error); }
};

const firebaseLogin = async (req, res, next) => {
  try {
    const result = await authService.syncFirebaseUser(req.body?.idToken, req.body?.profile || {});
    res.status(200).json({ message: "Firebase authentication successful", ...result });
  } catch (error) { next(error); }
};

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  forgotPassword,
  resetPassword,
  googleLogin,
  firebaseLogin,
};
