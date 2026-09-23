const User = require("../models/User");
const bcrypt = require("bcrypt");
const generateToken = require("../utils/jwt");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { OAuth2Client } = require("google-auth-library");
const { getFirebaseAuth } = require("../config/firebaseAdmin");

const publicUser = (user) => ({ id: user._id, name: user.name, email: user.email, avatar: user.avatar, role: user.role, authProvider: user.authProvider, college: user.college, course: user.course, year: user.year });

const registerUser = async ({ name, email, password, college, course, year }) => {
  const normalizedName = String(name || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (normalizedName.length < 2 || !/^\S+@\S+\.\S+$/.test(normalizedEmail) || String(password || "").length < 8) {
    const error = new Error("Provide a name, valid email, and a password with at least 8 characters.");
    error.statusCode = 400;
    throw error;
  }
  const existingUser = await User.findOne({ email: normalizedEmail });

  if (existingUser) {
    const error = new Error("User already exists");
    error.statusCode = 409;
    throw error;
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await User.create({
    name: normalizedName,
    email: normalizedEmail,
    password: hashedPassword,
    authProvider: "local",
    college: String(college || "").trim(),
    course: String(course || "").trim(),
    year: String(year || "").trim(),
  });

  return {
    user: publicUser(user),
    token: generateToken(user._id),
  };
};

const loginUser = async ({ email, password }) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !password) {
    const error = new Error("Email and password are required.");
    error.statusCode = 400;
    throw error;
  }
  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    const error = new Error("Invalid email or password");
    error.statusCode = 401;
    throw error;
  }

  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    const error = new Error("Invalid email or password");
    error.statusCode = 401;
    throw error;
  }

  if (user.accountStatus === "suspended") {
    const error = new Error("This account has been suspended.");
    error.statusCode = 403;
    throw error;
  }
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  return {
    user: publicUser(user),
    token: generateToken(user._id),
  };
};

const requestPasswordReset = async (email) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) return;
  const resetToken = crypto.randomBytes(32).toString("hex");
  user.passwordResetToken = crypto.createHash("sha256").update(resetToken).digest("hex");
  user.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000);
  await user.save({ validateBeforeSave: false });

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.FRONTEND_URL) {
    const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === "true", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    const resetUrl = `${process.env.FRONTEND_URL.replace(/\/$/, "")}/reset-password/${resetToken}`;
    await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: user.email, subject: "Reset your StudyGenie AI password", text: `Reset your password within 15 minutes: ${resetUrl}` });
  } else if (process.env.NODE_ENV !== "production") {
    // Local development only: enables an end-to-end reset without exposing tokens in production.
    return resetToken;
  }

};

const resetPassword = async ({ token, password } = {}) => {
  if (!token || String(password || "").length < 8) {
    const error = new Error("Use a valid reset link and a password with at least 8 characters."); error.statusCode = 400; throw error;
  }
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const user = await User.findOne({ passwordResetToken: tokenHash, passwordResetExpires: { $gt: new Date() } });
  if (!user) { const error = new Error("This reset link is invalid or has expired."); error.statusCode = 400; throw error; }
  user.password = await bcrypt.hash(password, 10);
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();
};

const loginWithGoogle = async (idToken) => {
  if (!process.env.GOOGLE_CLIENT_ID) { const error = new Error("Google sign-in is not configured."); error.statusCode = 503; throw error; }
  if (!idToken) { const error = new Error("A Google identity token is required."); error.statusCode = 400; throw error; }
  let ticket;
  try {
    ticket = await new OAuth2Client(process.env.GOOGLE_CLIENT_ID).verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
  } catch {
    const error = new Error("Google could not verify this sign-in."); error.statusCode = 401; throw error;
  }
  const profile = ticket.getPayload();
  if (!profile?.email || !profile.email_verified) { const error = new Error("Google could not verify this account."); error.statusCode = 401; throw error; }
  let user = await User.findOne({ email: profile.email.toLowerCase() });
  if (!user) user = await User.create({ name: profile.name || profile.email.split("@")[0], email: profile.email.toLowerCase(), password: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10), avatar: profile.picture || "", authProvider: "google" });
  if (user.accountStatus === "suspended") { const error = new Error("This account has been suspended."); error.statusCode = 403; throw error; }
  user.lastLogin = new Date();
  user.authProvider = user.authProvider === "local" ? "google" : user.authProvider;
  await user.save({ validateBeforeSave: false });
  return { user: publicUser(user), token: generateToken(user._id) };
};

const syncFirebaseUser = async (idToken, profile = {}) => {
  profile = profile && typeof profile === "object" ? profile : {};
  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth) { const error = new Error("Firebase Authentication is not configured on the server."); error.statusCode = 503; throw error; }
  if (!idToken) { const error = new Error("A Firebase ID token is required."); error.statusCode = 400; throw error; }
  let decoded;
  try { decoded = await firebaseAuth.verifyIdToken(idToken, true); } catch { const error = new Error("Firebase authentication could not be verified."); error.statusCode = 401; throw error; }
  const email = String(decoded.email || profile.email || "").trim().toLowerCase();
  if (!email || decoded.email_verified === false) { const error = new Error("A verified Firebase email is required."); error.statusCode = 401; throw error; }
  const provider = decoded.firebase?.sign_in_provider === "google.com" ? "google" : "password";
  let user = await User.findOne({ firebaseUid: decoded.uid });
  if (!user) user = await User.findOne({ email });
  if (!user) {
    user = new User({ name: profile.name || decoded.name || email.split("@")[0], email, password: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10), avatar: profile.avatar || decoded.picture || "", firebaseUid: decoded.uid, authProvider: provider, college: String(profile.college || "").trim(), course: String(profile.course || "").trim(), year: String(profile.year || "").trim() });
  } else {
    if (user.firebaseUid && user.firebaseUid !== decoded.uid) { const error = new Error("This email is already linked to another sign-in provider."); error.statusCode = 409; throw error; }
    user.firebaseUid = decoded.uid;
    user.authProvider = provider;
    if (profile.college) user.college = String(profile.college).trim();
    if (profile.course) user.course = String(profile.course).trim();
    if (profile.year) user.year = String(profile.year).trim();
    if (profile.name || decoded.name) user.name = user.name || profile.name || decoded.name;
    if (!user.avatar) user.avatar = profile.avatar || decoded.picture || "";
  }
  if (user.accountStatus === "suspended") { const error = new Error("This account has been suspended."); error.statusCode = 403; throw error; }
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });
  return { user: publicUser(user), token: generateToken(user._id) };
};

module.exports = {
  registerUser,
  loginUser,
  requestPasswordReset,
  resetPassword,
  loginWithGoogle,
  syncFirebaseUser,
};
