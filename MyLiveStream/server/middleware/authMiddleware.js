/**
 * -------------------------------------------------------
 * File: middleware/auth.js
 * Purpose:
 * Protects API routes by verifying the JWT access token
 * attached to incoming requests and attaching the
 * authenticated user to the request object.
 *
 * This middleware is the gatekeeper for all protected
 * endpoints. Any route that requires authentication should
 * include this middleware in its chain.
 *
 * High‑Level Workflow:
 * 1. Extract the Bearer token from the Authorization header.
 * 2. If no token is present, immediately return 401.
 * 3. Verify the token's signature and expiry using the
 *    access token secret.
 * 4. Look up the user by the ID embedded in the token.
 * 5. Attach the user document (minus password) to `req.user`.
 * 6. Call `next()` to pass control to the route handler.
 * 7. On any failure (invalid signature, expired token,
 *    user not found), return 401.
 *
 * Design Decisions:
 * - **`.select('-password')`:** The password hash is
 *   excluded from the user document fetched here. Even
 *   though the hash is not directly exposed in API
 *   responses, it's good practice to never load it into
 *   memory unless absolutely necessary (e.g., during login).
 * - **Generic "Token failed" message:** The error message
 *   is intentionally vague to avoid leaking information
 *   about *why* the token failed (expired vs. malformed
 *   vs. user deleted). A consistent message prevents
 *   attackers from probing token validity.
 * - **Token extraction:** Uses optional chaining
 *   (`?.split(' ')[1]`) to safely handle malformed
 *   Authorization headers without throwing.
 *
 * Security Considerations:
 * - The access token secret (`JWT_ACCESS_SECRET`) should
 *   be a strong, randomly generated string stored in
 *   environment variables — never hardcoded or committed.
 * - Access tokens should have a short lifespan (e.g., 15
 *   minutes). The client uses the refresh token flow to
 *   obtain new access tokens transparently.
 * - This middleware does not perform any authorisation
 *   checks (roles, permissions). It only verifies that
 *   the requester is a valid, authenticated user.
 *
 * Edge Cases Handled:
 * - Missing Authorization header → 401.
 * - Malformed header (e.g., missing "Bearer " prefix) →
 *   `split(' ')[1]` returns `undefined`, treated as no token.
 * - Expired token → `jwt.verify` throws, caught by try/catch.
 * - Tampered token (invalid signature) → `jwt.verify` throws.
 * - User deleted after token was issued → `findById` returns
 *   `null`, `req.user` is `null` (route handler should check).
 *
 * Usage:
 * ```
 * import { protect } from '../middleware/auth.js';
 * router.get('/me', protect, getMe);
 * ```
 *
 * Dependencies:
 * - jsonwebtoken: Token verification
 * - ../models/User.js: User model for database lookup
 * - ../config/env.js: `JWT_ACCESS_SECRET` for verification
 * -------------------------------------------------------
 */

import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { JWT_ACCESS_SECRET } from '../config/env.js';

// ----------------------------------------------------------------------
// Protect Middleware
// ----------------------------------------------------------------------

/**
 * Authenticates a request by verifying the JWT access token
 * in the Authorization header.
 *
 * On success, attaches the full user document (without the
 * password hash) to `req.user` and calls `next()`.
 *
 * On failure, returns a 401 JSON response with a generic
 * error message.
 *
 * @param {import('express').Request} req  - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next function
 * @returns {Promise<void>}
 *
 * @example
 * // Protect a single route
 * router.get('/profile', protect, (req, res) => {
 *   res.json({ user: req.user });
 * });
 *
 * @example
 * // Protect all routes in a router
 * router.use(protect);
 * router.get('/profile', getProfile);
 * router.put('/settings', updateSettings);
 */
export const protect = async (req, res, next) => {
  /**
   * Extract the token from the Authorization header.
   *
   * Expected format: `Bearer <token>`
   *
   * `?.split(' ')[1]` safely handles:
   * - Missing header → `undefined?.split(...)` → `undefined`
   * - Header without "Bearer " → `['token']` → `[1]` is `undefined`
   * - Empty header value → `''.split(' ')` → `['']` → `[1]` is `undefined`
   */
  let token = req.headers.authorization?.split(' ')[1];

  // If no token is present, fail immediately.
  // We use a generic message to avoid leaking information
  // about the auth mechanism.
  if (!token) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  try {
    /**
     * Verify the token's signature and expiry.
     *
     * `jwt.verify` throws if:
     * - The token is expired (`TokenExpiredError`).
     * - The signature is invalid (`JsonWebTokenError`).
     * - The token is malformed (`JsonWebTokenError`).
     *
     * All of these are caught by the `catch` block below.
     */
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET);

    /**
     * Fetch the user from the database.
     *
     * `.select('-password')` excludes the password hash
     * from the returned document. This is a defence‑in‑depth
     * measure: even if a route handler accidentally logs or
     * returns `req.user`, the hash will not be included.
     *
     * If the user has been deleted since the token was issued,
     * `findById` returns `null`. The route handler is responsible
     * for checking `req.user` — this middleware does not return
     * 401 for a missing user because the token itself was valid;
     * the user simply no longer exists.
     */
    req.user = await User.findById(decoded.id).select('-password');

    // Authentication successful — pass control to the next
    // middleware or route handler.
    next();
  } catch (err) {
    /**
     * Token verification failed.
     *
     * Possible reasons:
     * - `TokenExpiredError` — The token's `exp` claim is in the past.
     * - `JsonWebTokenError` — Invalid signature or malformed token.
     * - `NotBeforeError` — The token's `nbf` claim is in the future.
     *
     * We return a generic "Token failed" message for all cases
     * to avoid leaking information about which specific failure
     * occurred. A consistent response makes it harder for an
     * attacker to probe token validity or expiry windows.
     */
    return res.status(401).json({ message: 'Token failed' });
  }
};