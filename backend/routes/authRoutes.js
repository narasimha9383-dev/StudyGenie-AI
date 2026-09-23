const express = require("express");
const router = express.Router();

const {
  registerUser,
  loginUser,
  logoutUser,
  forgotPassword,
  resetPassword,
  googleLogin,
  firebaseLogin,
} = require("../controllers/authController");

router.post("/register", registerUser);

router.post("/login", loginUser);

router.post("/logout", logoutUser);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/google", googleLogin);
router.post("/firebase", firebaseLogin);

module.exports = router;
