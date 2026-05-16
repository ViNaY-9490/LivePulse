/**
 * -------------------------------------------------------
 * File: utils/generateTokens.js
 * Purpose:
 * Generates JWT access and refresh tokens for authenticated
 * users. This module is the single place where tokens are
 * created, ensuring consistent signing secrets, expiry
 * durations, and payload structure across the application.
 *
 * High‑Level Workflow:
 * 1. Call `generateAccessToken(userId)` to create a short‑lived
 *    token used for API request authentication.
 * 2. Call `generateRefreshToken(userId)` to create a longer‑lived
 *    token used to obtain new access tokens without re‑logging in.
 *
 * Design Decisions:
 * - **Separate secrets for access and refresh tokens:**
 *   Compromising the access token secret (which is used on
 *   every request) should not compromise refresh tokens.
 * - **`ensureSecret` guard:** Throws immediately at call time
 *   if a secret is not configured, rather than letting JWT
 *   sign with `undefined` and produce an invalid token that
 *   fails later with a cryptic error.
 * - **Payload is minimal (`{ id }`):** Only the user ID is
 *   embedded. Additional claims (role, permissions) can be
 *   added here and will be available to all token consumers.
 * - **Expiry is configurable via environment variables:**
 *   Allows shorter token lifetimes in production and longer
 *   ones in development without code changes.
 *
 * Token Usage:
 * - Access token: Sent in the `Authorization: Bearer <token>`
 *   header. Validated by the `protect` middleware.
 * - Refresh token: Sent in the request body to
 *   `POST /api/auth/refresh-token`. Validated by the
 *   `refreshToken` controller.
 *
 * Security Notes:
 * - Tokens are signed, not encrypted. The payload is readable
 *   by anyone with the token. Never put sensitive data
 *   (passwords, emails) in the payload.
 * - Access tokens should be short‑lived (default: 15 minutes)
 *   to limit the window for stolen token misuse.
 *
 * Dependencies:
 * - jsonwebtoken: JWT creation and signing
 * - ../config/env.js: Secrets and expiry durations
 * -------------------------------------------------------
 */

import jwt from 'jsonwebtoken';
import {
  ACCESS_TOKEN_EXPIRE,
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  REFRESH_TOKEN_EXPIRE,
} from '../config/env.js';

// ----------------------------------------------------------------------
// Internal Helpers
// ----------------------------------------------------------------------

/**
 * Validates that a secret is configured before use.
 *
 * Why this exists:
 * If `JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET` is missing
 * from the environment, calling `jwt.sign()` with `undefined`
 * would produce a token signed with the string `"undefined"` —
 * a serious security vulnerability that could go unnoticed.
 *
 * This function throws immediately with a clear error message,
 * preventing the server from starting or handling requests
 * with misconfigured secrets.
 *
 * @param {string|undefined} secret - The secret from environment
 * @param {string} name - The environment variable name (for the error message)
 * @returns {string} The validated secret
 * @throws {Error} If the secret is not configured
 */
const ensureSecret = (secret, name) => {
  if (!secret) {
    throw new Error(`${name} is not configured`);
  }
  return secret;
};

// ----------------------------------------------------------------------
// Token Generators
// ----------------------------------------------------------------------

/**
 * Generates a short‑lived JWT access token.
 *
 * The access token is used to authenticate API requests.
 * It is sent in the `Authorization: Bearer <token>` header
 * and validated by the `protect` middleware.
 *
 * Payload: `{ id: userId }`
 * Expiry:   Configured by `ACCESS_TOKEN_EXPIRE` (default: 15 minutes).
 *
 * @param {string} userId - The MongoDB user ID to embed in the token
 * @returns {string} A signed JWT access token
 *
 * @example
 * const token = generateAccessToken(user._id);
 * // token = "eyJhbGciOiJIUzI1NiIs..."
 */
const generateAccessToken = (userId) =>
  jwt.sign(
    { id: userId },
    ensureSecret(JWT_ACCESS_SECRET, 'JWT_ACCESS_SECRET'),
    { expiresIn: ACCESS_TOKEN_EXPIRE },
  );

/**
 * Generates a longer‑lived JWT refresh token.
 *
 * The refresh token is used to obtain new access tokens
 * without requiring the user to log in again. It is sent
 * in the request body to `POST /api/auth/refresh-token`.
 *
 * Payload: `{ id: userId }`
 * Expiry:   Configured by `REFRESH_TOKEN_EXPIRE` (default: 7 days).
 *
 * @param {string} userId - The MongoDB user ID to embed in the token
 * @returns {string} A signed JWT refresh token
 *
 * @example
 * const token = generateRefreshToken(user._id);
 * // token = "eyJhbGciOiJIUzI1NiIs..."
 */
const generateRefreshToken = (userId) =>
  jwt.sign(
    { id: userId },
    ensureSecret(JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET'),
    { expiresIn: REFRESH_TOKEN_EXPIRE },
  );

// ----------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------

export { generateAccessToken, generateRefreshToken };