/**
 * -------------------------------------------------------
 * File: controllers/authController.js
 * Purpose:
 * Handles all authentication‑related HTTP request/response
 * logic. This controller is the server‑side counterpart to
 * the client's `authApi.js` module.
 *
 * Endpoints implemented:
 * - `signup`           — Register a new user account
 * - `verifyOtp`        — Verify OTP and complete registration
 * - `login`            — Authenticate and send OTP for 2FA
 * - `verifyLoginOtp`   — Verify OTP and complete login
 * - `resendOtp`        — Resend OTP for signup or login
 * - `refreshToken`     — Rotate access + refresh token pair
 * - `securityQuestion` — Retrieve a user's security question
 * - `verifySecurity`   — Verify security answer and reset password
 * - `googleCallback`   — Handle Google OAuth callback
 * - `getMe`            — Return the authenticated user's profile
 *
 * High‑Level Architecture:
 * 1. All handlers are wrapped in `asyncHandler` to catch
 *    unhandled promise rejections and forward them to the
 *    Express error middleware.
 * 2. Business logic (password hashing, token generation,
 *    email sending) is delegated to utility modules and
 *    the User model.
 * 3. The controller is responsible only for request
 *    validation, orchestration, and response formatting.
 *
 * Security Decisions:
 * - **Password strength enforcement:** Minimum 8 characters
 *   checked server‑side (not just client‑side) to prevent
 *   weak passwords via direct API calls.
 * - **OTP expiry:** 10‑minute TTL prevents brute‑force
 *   attempts on the OTP endpoint.
 * - **Token rotation:** `refreshToken` issues a new token
 *   pair and invalidates the old refresh token, limiting
 *   the window for stolen refresh tokens.
 * - **`toPublicUser` filter:** Never returns the password
 *   hash, security answer, or internal fields to the client.
 * - **Input sanitisation:** All string inputs are trimmed;
 *   email is lowercased; lengths are capped where appropriate.
 *
 * Edge Cases Handled:
 * - Duplicate email during signup → 400.
 * - Unverified account attempting login → 403.
 * - Expired or invalid OTP → 400/401.
 * - Refresh token reuse → 403 (token already removed from
 *   the user's stored tokens).
 * - Missing security question → 404.
 * - Email send failure during signup → user is rolled back
 *   (deleted) to prevent orphaned unverified accounts.
 *
 * Dependencies:
 * - crypto: Cryptographically secure OTP generation
 * - jsonwebtoken: Refresh token verification
 * - ../models/User.js: Mongoose User model
 * - ../config/env.js: Environment variables
 * - ../utils/generateTokens.js: JWT generation helpers
 * - ../utils/sendEmail.js: OTP email sender
 * - ../utils/asyncHandler.js: Async error wrapper
 * -------------------------------------------------------
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { CLIENT_URL, JWT_REFRESH_SECRET } from '../config/env.js';
import {
  generateAccessToken,
  generateRefreshToken,
} from '../utils/generateTokens.js';
import { sendOTP } from '../utils/sendEmail.js';
import asyncHandler from '../utils/asyncHandler.js';

// ----------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------

/**
 * OTP validity window: 10 minutes.
 *
 * Why 10 minutes:
 * - Long enough for email delivery delays (greylisting,
 *   spam filters, user checking their inbox).
 * - Short enough to limit the brute‑force window if an
 *   attacker obtains a user ID.
 */
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Minimum accepted password length.
 *
 * Enforced server‑side even though the client also validates,
 * because client‑side validation can be bypassed.
 */
const MIN_PASSWORD_LENGTH = 8;

// ----------------------------------------------------------------------
// Internal Helpers
// ----------------------------------------------------------------------

/**
 * Generates a cryptographically secure 6‑digit OTP.
 *
 * Uses `crypto.randomInt` (available in Node.js 14+)
 * which avoids the modulo bias of `Math.random()`.
 *
 * @returns {string} A 6‑digit OTP as a zero‑padded string
 */
const createOtp = () => crypto.randomInt(100000, 1000000).toString();

/**
 * Assigns a new OTP and expiry to a user document.
 *
 * Why mutate the user object directly:
 * The caller is responsible for calling `user.save()` after
 * this function returns. This keeps the OTP assignment
 * atomic with the rest of the operation (e.g., signup or
 * login).
 *
 * @param {import('mongoose').Document} user - The user document to modify
 * @returns {string} The generated OTP (so the caller can send it via email)
 */
const assignOtp = (user) => {
  const otp = createOtp();
  user.otp = otp;
  user.otpExpires = new Date(Date.now() + OTP_TTL_MS);
  return otp;
};

/**
 * Converts a User document to a safe, public‑facing object.
 *
 * Why this exists:
 * The User model contains sensitive fields (password hash,
 * security answer, refresh tokens, OTP data) that must
 * never be sent to the client. This function whitelists
 * only the fields that are safe to expose.
 *
 * @param {import('mongoose').Document} user - The full user document
 * @returns {{ id: string, name: string, email: string, isVerified: boolean }}
 */
const toPublicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  isVerified: user.isVerified,
});

/**
 * Validates password strength server‑side.
 *
 * Why server‑side:
 * Client‑side validation is a UX convenience, not a
 * security measure. An attacker can bypass it by calling
 * the API directly. This check is the authoritative gate.
 *
 * @param {string} password - The raw password to check
 * @returns {boolean} True if the password meets minimum requirements
 */
const isStrongEnoughPassword = (password) =>
  typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH;

// ----------------------------------------------------------------------
// POST /signup
// ----------------------------------------------------------------------

/**
 * Registers a new user account.
 *
 * Workflow:
 * 1. Validate and sanitise all required fields.
 * 2. Check password strength.
 * 3. Reject duplicate emails.
 * 4. Create the user document with an assigned OTP.
 * 5. Send the OTP via email.
 * 6. If email fails, roll back the user to prevent orphaned
 *    unverified accounts.
 *
 * The account is created in an unverified state. The user
 * must call `/verify-otp` to activate it.
 */
const signup = asyncHandler(async (req, res) => {
  const { name, email, password, securityQuestion, securityAnswer } =
    req.body;

  // Sanitise inputs: trim whitespace, enforce max lengths,
  // lowercase email for case‑insensitive uniqueness.
  const cleanName =
    typeof name === 'string' ? name.trim().slice(0, 80) : '';
  const cleanEmail =
    typeof email === 'string' ? email.trim().toLowerCase() : '';
  const cleanQuestion =
    typeof securityQuestion === 'string'
      ? securityQuestion.trim().slice(0, 200)
      : '';
  const cleanAnswer =
    typeof securityAnswer === 'string' ? securityAnswer.trim() : '';

  // Validate required fields
  if (
    !cleanName ||
    !cleanEmail ||
    !password ||
    !cleanQuestion ||
    !cleanAnswer
  ) {
    return res.status(400).json({
      message:
        'Name, email, password, security question, and answer are required',
    });
  }

  // Validate password strength
  if (!isStrongEnoughPassword(password)) {
    return res.status(400).json({
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
  }

  // Check for existing user with the same email
  const existingUser = await User.findOne({ email: cleanEmail });
  if (existingUser) {
    return res.status(400).json({ message: 'User already exists' });
  }

  // Create user (password is hashed by the User model's pre‑save hook)
  const user = new User({
    name: cleanName,
    email: cleanEmail,
    password,
    securityQuestion: cleanQuestion,
    securityAnswer: cleanAnswer,
  });

  // Assign OTP and persist
  const otp = assignOtp(user);
  await user.save();

  // Send OTP email — if this fails, roll back the user to
  // prevent an orphaned unverified account that can never
  // receive an OTP.
  try {
    await sendOTP(cleanEmail, otp);
  } catch (err) {
    await User.deleteOne({ _id: user._id });
    throw err; // Let asyncHandler pass it to the error middleware
  }

  return res.status(201).json({
    message: 'Registration successful. OTP sent to email.',
    userId: user._id,
  });
});

// ----------------------------------------------------------------------
// POST /verify-otp
// ----------------------------------------------------------------------

/**
 * Verifies the OTP sent during signup and completes
 * registration.
 *
 * On success:
 * - Marks the user as verified.
 * - Clears OTP fields.
 * - Generates and returns access + refresh tokens.
 * - The user is now fully authenticated.
 */
const verifyOtp = asyncHandler(async (req, res) => {
  const { userId, otp } = req.body;

  if (!userId || !otp) {
    return res.status(400).json({ message: 'User ID and OTP required' });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  // Verify OTP: must match exactly and not be expired
  if (
    user.otp !== String(otp) ||
    !user.otpExpires ||
    user.otpExpires.getTime() < Date.now()
  ) {
    return res.status(400).json({ message: 'Invalid or expired OTP' });
  }

  // Mark as verified and clear OTP data
  user.isVerified = true;
  user.otp = undefined;
  user.otpExpires = undefined;

  // Generate token pair
  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  // Store refresh token for rotation tracking
  user.refreshTokens.push({ token: refreshToken });
  await user.save();

  return res.json({
    accessToken,
    refreshToken,
    user: toPublicUser(user),
  });
});

// ----------------------------------------------------------------------
// POST /login
// ----------------------------------------------------------------------

/**
 * Authenticates a user with email and password.
 *
 * This is the first step of a two‑step login flow:
 * 1. Validate credentials.
 * 2. If valid, generate and send an OTP to the user's email.
 * 3. The client must then call `/verify-login-otp` to
 *    complete authentication and receive tokens.
 *
 * Why OTP after password:
 * This provides two‑factor authentication. Even if an
 * attacker obtains the password, they cannot log in
 * without access to the user's email.
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const cleanEmail =
    typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!cleanEmail || !password) {
    return res.status(400).json({ message: 'Email and password required' });
  }

  const user = await User.findOne({ email: cleanEmail });

  // Use a generic "Invalid credentials" message to avoid
  // leaking whether the email exists in our database.
  if (!user || !user.password) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  // Block login for unverified accounts
  if (!user.isVerified) {
    return res.status(403).json({ message: 'Account not verified' });
  }

  // Compare password against stored hash (bcrypt)
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  // Assign OTP for 2FA
  const otp = assignOtp(user);
  await user.save();
  console.log('before send otp');
  try {
  await sendOTP(user.email, otp);
} catch (err) {
  console.error("SEND OTP ERROR:", err);

  return res.status(500).json({
    message: "Failed to send OTP email",
    error: err.message,
  });
}
console.log('after send otp');

  return res.json({
    message: 'OTP sent to your email',
    userId: user._id,
    requiresOtp: true,
  });
});

// ----------------------------------------------------------------------
// POST /verify-login-otp
// ----------------------------------------------------------------------

/**
 * Verifies the OTP sent during login and returns tokens.
 *
 * This is the second step of the login flow. On success,
 * the user receives access and refresh tokens and is
 * fully authenticated.
 */
const verifyLoginOtp = asyncHandler(async (req, res) => {
  const { userId, otp } = req.body;

  if (!userId || !otp) {
    return res.status(400).json({ message: 'User ID and OTP required' });
  }

  const user = await User.findById(userId);

  // Verify OTP validity
  if (
    !user ||
    user.otp !== String(otp) ||
    !user.otpExpires ||
    user.otpExpires.getTime() < Date.now()
  ) {
    return res.status(401).json({ message: 'Invalid or expired OTP' });
  }

  // Clear OTP data — it's single‑use
  user.otp = undefined;
  user.otpExpires = undefined;

  // Generate token pair
  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  user.refreshTokens.push({ token: refreshToken });
  await user.save();

  return res.json({
    accessToken,
    refreshToken,
    user: toPublicUser(user),
  });
});

// ----------------------------------------------------------------------
// POST /resend-otp
// ----------------------------------------------------------------------

/**
 * Resends the OTP to the user's email.
 *
 * Used when:
 * - The original OTP email was delayed or lost.
 * - The previous OTP expired before the user could enter it.
 *
 * Behaviour differs by `type`:
 * - `signup`: Only resends if the account is not yet verified.
 * - `login`: Always resends (the user is already verified).
 */
const resendOtp = asyncHandler(async (req, res) => {
  const { userId, type = 'signup' } = req.body;

  if (!userId) {
    return res.status(400).json({ message: 'User ID required' });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  // Prevent resending OTP for already‑verified signup accounts
  if (type === 'signup' && user.isVerified) {
    return res
      .status(400)
      .json({ message: 'Account is already verified' });
  }

  // Generate a fresh OTP (invalidates the previous one)
  const otp = assignOtp(user);
  await user.save();
  await sendOTP(user.email, otp);

  return res.json({ message: 'OTP sent to your email' });
});

// ----------------------------------------------------------------------
// POST /refresh-token
// ----------------------------------------------------------------------

/**
 * Rotates the access and refresh token pair.
 *
 * Token rotation strategy:
 * 1. Verify the incoming refresh token's signature and expiry.
 * 2. Confirm the token exists in the user's stored tokens
 *    (prevents reuse of already‑rotated tokens).
 * 3. Remove the old refresh token (single‑use).
 * 4. Generate and store a new token pair.
 * 5. Return the new tokens to the client.
 *
 * Why rotate:
 * If a refresh token is stolen, it can only be used once.
 * When the legitimate user's client tries to use it next,
 * it will fail (token not found), alerting the system to
 * a potential compromise. The user can then be forced to
 * re‑authenticate.
 */
const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken: incomingRefreshToken } = req.body;

  if (!incomingRefreshToken) {
    return res.status(400).json({ message: 'Refresh token required' });
  }

  try {
    // Verify the token's signature and expiry
    const decoded = jwt.verify(incomingRefreshToken, JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);

    // Check that the token is still in the user's stored set.
    // If it's missing, this token has already been used (or
    // revoked) — reject to prevent token reuse.
    if (
      !user ||
      !user.refreshTokens.some((rt) => rt.token === incomingRefreshToken)
    ) {
      return res.status(403).json({ message: 'Invalid refresh token' });
    }

    // Remove the used refresh token (single‑use)
    user.refreshTokens = user.refreshTokens.filter(
      (rt) => rt.token !== incomingRefreshToken,
    );

    // Generate new token pair
    const newAccessToken = generateAccessToken(user._id);
    const newRefreshToken = generateRefreshToken(user._id);

    // Store the new refresh token
    user.refreshTokens.push({ token: newRefreshToken });
    await user.save();

    return res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    // Covers: expired token, malformed token, wrong secret
    return res.status(403).json({ message: 'Invalid refresh token' });
  }
});

// ----------------------------------------------------------------------
// POST /security-question
// ----------------------------------------------------------------------

/**
 * Retrieves the security question for a given email.
 *
 * This is the first step of the password reset flow.
 * The question is returned so the user can provide the
 * answer in a subsequent call to `/verify-security`.
 *
 * Security note:
 * We use `.select('securityQuestion')` to fetch only the
 * question field, minimising the data exposed even if the
 * endpoint is probed.
 */
const securityQuestion = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ message: 'A valid email is required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const user = await User.findOne({ email: cleanEmail }).select(
    'securityQuestion',
  );

  if (!user?.securityQuestion) {
    return res
      .status(404)
      .json({ message: 'Security question not found' });
  }

  return res.json({ question: user.securityQuestion });
});

// ----------------------------------------------------------------------
// POST /verify-security
// ----------------------------------------------------------------------

/**
 * Verifies the security answer and resets the user's password.
 *
 * This is the second step of the password reset flow.
 *
 * On success:
 * - The password is updated (hashed by the model's pre‑save hook).
 * - All refresh tokens are invalidated, forcing re‑authentication
 *   on all devices. This is a security measure — if someone is
 *   resetting the password, any existing sessions may be
 *   compromised.
 */
const verifySecurity = asyncHandler(async (req, res) => {
  const { email, answer, newPassword } = req.body;
  const cleanEmail =
    typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!cleanEmail || !answer || !newPassword) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  if (!isStrongEnoughPassword(newPassword)) {
    return res.status(400).json({
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
  }

  const user = await User.findOne({ email: cleanEmail });
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  // Compare the provided answer against the stored hash
  const isCorrectAnswer = await user.compareSecurityAnswer(answer);
  if (!isCorrectAnswer) {
    return res.status(401).json({ message: 'Incorrect answer' });
  }

  // Update password and invalidate all existing sessions
  user.password = newPassword;
  user.refreshTokens = [];
  await user.save();

  return res.json({
    message: 'Password reset successful. Please sign in.',
  });
});

// ----------------------------------------------------------------------
// GET /auth/google/callback
// ----------------------------------------------------------------------

/**
 * Handles the Google OAuth callback after successful
 * authentication with Google.
 *
 * The user is attached to `req.user` by Passport's Google
 * strategy middleware. This handler generates tokens and
 * redirects the browser to the client's `/oauth` page with
 * the tokens in the URL query string.
 *
 * Why tokens in URL:
 * This is the standard OAuth redirect flow. The client's
 * `OAuthHandler` page extracts the tokens, stores them,
 * fetches the user profile, and redirects to the dashboard
 * — all within seconds. The callback URL is replaced in
 * browser history to prevent token leakage via the back
 * button.
 */
const googleCallback = asyncHandler(async (req, res) => {
  const user = req.user;

  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  user.refreshTokens.push({ token: refreshToken });
  await user.save();

  // Build the redirect URL with tokens as query parameters
  const params = new URLSearchParams({ accessToken, refreshToken });
  return res.redirect(`${CLIENT_URL}/oauth?${params.toString()}`);
});

// ----------------------------------------------------------------------
// GET /me
// ----------------------------------------------------------------------

/**
 * Returns the authenticated user's profile.
 *
 * This endpoint is protected by the `authenticate` middleware,
 * which attaches the user to `req.user`. It simply returns
 * the sanitised public user object.
 */
const getMe = asyncHandler(async (req, res) => {
  const user = req.user;

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  return res.json(toPublicUser(user));
});

// ----------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------

export {
  signup,
  verifyOtp,
  login,
  verifyLoginOtp,
  resendOtp,
  refreshToken,
  securityQuestion,
  verifySecurity,
  googleCallback,
  getMe,
};