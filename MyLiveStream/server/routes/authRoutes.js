/**
 * -------------------------------------------------------
 * File: routes/authRoutes.js
 * Purpose:
 * Defines all authentication‑related API routes for the
 * Express application. This router is mounted at the base
 * path configured in the server (typically `/api/auth`).
 *
 * Routes:
 * - POST /signup             — Register a new user account
 * - POST /verify-otp         — Verify OTP and complete signup
 * - POST /login              — Authenticate and request OTP
 * - POST /verify-login-otp   — Verify OTP and complete login
 * - POST /resend-otp         — Resend OTP for signup or login
 * - POST /refresh-token      — Rotate access + refresh token pair
 * - POST /security-question  — Retrieve security question by email
 * - POST /verify-security    — Verify answer and reset password
 * - GET  /me                 — Get authenticated user's profile
 * - GET  /google             — Initiate Google OAuth flow
 * - GET  /google/callback    — Handle Google OAuth callback
 *
 * Middleware Applied:
 * - `authLimiter` — Rate limiting on sensitive endpoints
 *   (login, signup, OTP, security question/answer).
 * - `protect` — JWT authentication on `/me`.
 * - `requireGoogleAuth` — Blocks Google OAuth routes if
 *   `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` are not
 *   configured.
 * - `passport.authenticate('google')` — Handles the Google
 *   OAuth 2.0 redirect and callback flow.
 *
 * Design Decisions:
 * - **Rate limiting placement:** Applied only to endpoints
 *   that could be abused (auth attempts). `/refresh-token`
 *   and `/me` are not rate‑limited here because:
 *   - `/refresh-token` is called automatically by the Axios
 *     interceptor; rate limiting could break silent refresh.
 *   - `/me` is a simple lookup; it's protected by JWT auth
 *     and low‑cost.
 * - **Google OAuth disabled gracefully:** If Google OAuth
 *   credentials are not configured, the routes return 503
 *   (Service Unavailable) rather than crashing or exposing
 *   undefined behaviour.
 * - **Stateless OAuth (`session: false`):** Passport does
 *   not create a server‑side session. Tokens are returned
 *   to the client in the redirect URL, and the client
 *   manages them.
 *
 * Security Notes:
 * - `authLimiter` provides brute‑force protection at the
 *   network level before the request reaches the controller.
 * - Google OAuth routes check credentials at the middleware
 *   level, so an unconfigured server cannot accidentally
 *   expose a broken OAuth flow.
 *
 * Usage:
 * This router is mounted in the main server file:
 * ```
 * import authRoutes from './routes/authRoutes.js';
 * app.use('/api/auth', authRoutes);
 * ```
 *
 * Dependencies:
 * - express: Router creation
 * - passport: Google OAuth 2.0 strategy
 * - ../config/env.js: Google OAuth credentials
 * - ../middleware/authMiddleware.js: `protect` JWT middleware
 * - ../middleware/rateLimiter.js: `authLimiter`
 * - ../controllers/authController.js: All route handlers
 * -------------------------------------------------------
 */

import express from 'express';
import passport from 'passport';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '../config/env.js';
import { protect } from '../middleware/authMiddleware.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import {
  getMe,
  googleCallback,
  login,
  refreshToken,
  resendOtp,
  securityQuestion,
  signup,
  verifyLoginOtp,
  verifyOtp,
  verifySecurity,
} from '../controllers/authController.js';

// ----------------------------------------------------------------------
// Router Initialisation
// ----------------------------------------------------------------------

const router = express.Router();

// ----------------------------------------------------------------------
// Google OAuth Availability Check
// ----------------------------------------------------------------------

/**
 * Whether Google OAuth is properly configured.
 *
 * Both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must
 * be set in environment variables for the Google OAuth
 * flow to function. If either is missing, the Google routes
 * will return 503 (Service Unavailable).
 */
const isGoogleConfigured = Boolean(
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET,
);

// ----------------------------------------------------------------------
// Conditional Middleware
// ----------------------------------------------------------------------

/**
 * Blocks access to Google OAuth routes if the required
 * credentials are not configured.
 *
 * Why return 503 instead of 404:
 * 503 (Service Unavailable) accurately describes a server
 * that is functioning but has a specific feature disabled
 * due to missing configuration. 404 would imply the route
 * doesn't exist, which is misleading.
 *
 * @param {import('express').Request} req  - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next function
 */
const requireGoogleAuth = (req, res, next) => {
  if (!isGoogleConfigured) {
    return res
      .status(503)
      .json({ message: 'Google authentication is not configured' });
  }
  return next();
};

// ----------------------------------------------------------------------
// Routes — Authentication
// ----------------------------------------------------------------------

/**
 * POST /signup
 *
 * Registers a new user account.
 * Rate limited: 20 requests per 15 minutes per IP.
 */
router.post('/signup', authLimiter, signup);

/**
 * POST /verify-otp
 *
 * Verifies the OTP sent during signup and returns tokens.
 * Rate limited: prevents brute‑forcing OTP codes.
 */
router.post('/verify-otp', authLimiter, verifyOtp);

/**
 * POST /login
 *
 * Authenticates with email + password and sends an OTP
 * for two‑factor authentication.
 * Rate limited: prevents credential stuffing.
 */
router.post('/login', authLimiter, login);

/**
 * POST /verify-login-otp
 *
 * Verifies the OTP sent during login and returns tokens.
 * Rate limited: prevents brute‑forcing OTP codes.
 */
router.post('/verify-login-otp', authLimiter, verifyLoginOtp);

/**
 * POST /resend-otp
 *
 * Resends the OTP to the user's email.
 * Rate limited: prevents abusing the email‑sending endpoint.
 */
router.post('/resend-otp', authLimiter, resendOtp);

/**
 * POST /refresh-token
 *
 * Rotates the access + refresh token pair.
 * NOT rate limited: this endpoint is called automatically
 * by the Axios interceptor before every API call when the
 * access token is expired. Rate limiting here could break
 * silent refresh and force users to log in repeatedly.
 *
 * Security is maintained by:
 * - The refresh token itself is single‑use (rotation).
 * - Reuse of a rotated token is detected and rejected.
 */
router.post('/refresh-token', refreshToken);

/**
 * POST /security-question
 *
 * Retrieves the security question for a given email.
 * This is the first step of the password reset flow.
 * NOT rate limited: a legitimate user who forgot their
 * password shouldn't be blocked from starting recovery.
 * However, the endpoint does not expose sensitive data
 * (only the question text, never the answer).
 */
router.post('/security-question', securityQuestion);

/**
 * POST /verify-security
 *
 * Verifies the security answer and resets the password.
 * Rate limited: prevents brute‑forcing the answer.
 */
router.post('/verify-security', authLimiter, verifySecurity);

/**
 * GET /me
 *
 * Returns the authenticated user's profile.
 * Protected by `protect` middleware — requires a valid
 * JWT access token in the Authorization header.
 * NOT rate limited: this is a simple database lookup
 * called frequently by the client.
 */
router.get('/me', protect, getMe);

// ----------------------------------------------------------------------
// Routes — Google OAuth
// ----------------------------------------------------------------------

/**
 * GET /google
 *
 * Initiates the Google OAuth 2.0 flow.
 *
 * The user is redirected to Google's consent screen.
 * After authorisation, Google redirects back to
 * `/google/callback` with an authorisation code.
 *
 * `requireGoogleAuth` middleware returns 503 if Google
 * OAuth credentials are not configured.
 *
 * Scope: `profile` + `email` — we request the user's
 * basic profile information and email address.
 */
router.get(
  '/google',
  requireGoogleAuth,
  passport.authenticate('google', { scope: ['profile', 'email'] }),
);

/**
 * GET /google/callback
 *
 * Handles the Google OAuth callback after the user
 * authorises the application.
 *
 * Flow:
 * 1. Google redirects here with an authorisation code.
 * 2. Passport exchanges the code for an access token.
 * 3. Passport fetches the user's Google profile.
 * 4. The `googleCallback` controller creates or finds
 *    the user, generates JWT tokens, and redirects to
 *    the client's `/oauth` page with the tokens in the
 *    URL query string.
 *
 * `session: false` — Passport does not create a server‑side
 * session. Authentication state is transferred entirely
 * via the JWT tokens in the redirect URL.
 */
router.get(
  '/google/callback',
  requireGoogleAuth,
  passport.authenticate('google', { session: false }),
  googleCallback,
);

// ----------------------------------------------------------------------
// Export
// ----------------------------------------------------------------------

export default router;