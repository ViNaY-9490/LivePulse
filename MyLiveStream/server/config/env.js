/**
 * -------------------------------------------------------
 * File: config/env.js
 * Purpose:
 * Centralised environment variable management for the
 * LivePulse server. Loads variables from `.env` files,
 * parses and normalises them, and exports typed constants
 * for the rest of the application to consume.
 *
 * This is the **only** file that reads from `process.env`.
 * All other modules import their configuration from here,
 * making environment variable usage auditable and safe.
 *
 * High‑Level Workflow:
 * 1. Load `.env` file into `process.env` via `dotenv`.
 * 2. Parse and normalise each variable (ports as integers,
 *    CSV strings as arrays, defaults for optional values).
 * 3. In production: validate that all required variables
 *    are set — throw immediately if any are missing.
 * 4. In development: warn about missing optional variables
 *    but don't crash (allows partial local setup).
 *
 * Design Decisions:
 * - **`dotenv.config()` at module scope:** Runs once when
 *   this module is first imported. This must happen before
 *   any other module reads `process.env`.
 * - **Parsers (`parsePort`, `splitCsv`):** Extract common
 *   parsing logic into pure functions, avoiding duplicated
 *   `Number()` and `.split()` calls throughout the file.
 * - **Production validation:** The server *must* have certain
 *   variables set in production. Throwing at startup is
 *   safer than failing later with a cryptic error deep in
 *   some module.
 * - **Development leniency:** Missing variables in dev only
 *   produce warnings. This allows developers to work on
 *   features that don't require every service (e.g., working
 *   on chat without email configured).
 *
 * Edge Cases Handled:
 * - Port is not a number → falls back to default.
 * - Port is negative or zero → falls back to default.
 * - `CORS_ORIGINS` is empty or undefined → returns empty array.
 * - `CORS_ORIGINS` has extra whitespace → trimmed.
 * - Production missing required vars → throws immediately.
 *
 * Dependencies:
 * - dotenv: Loads `.env` files into `process.env`
 * -------------------------------------------------------
 */

import dotenv from 'dotenv';

// ----------------------------------------------------------------------
// Load .env
// ----------------------------------------------------------------------

/**
 * Load environment variables from `.env` file into `process.env`.
 *
 * This must run before any other module reads environment
 * variables. Variables in the `.env` file do **not** override
 * existing environment variables (e.g., those set by the
 * hosting platform). To override, use `dotenv.config({ override: true })`.
 */
dotenv.config();

// ----------------------------------------------------------------------
// Parsing Helpers
// ----------------------------------------------------------------------

/**
 * Parses a port number from an environment variable string.
 *
 * Why a dedicated parser:
 * Environment variables are always strings. `Number('')` is `0`,
 * and `Number(undefined)` is `NaN`. This function handles all
 * edge cases and returns the fallback when the value is invalid.
 *
 * @param {string|undefined} value - The raw environment variable
 * @param {number} fallback - The default port if parsing fails
 * @returns {number} A valid positive integer port number
 *
 * @example
 * parsePort('3000', 5001)    // → 3000
 * parsePort('invalid', 5001) // → 5001
 * parsePort(undefined, 5001) // → 5001
 * parsePort('0', 5001)       // → 5001 (0 is not a valid port)
 */
const parsePort = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Splits a comma‑separated environment variable into an array
 * of trimmed, non‑empty strings.
 *
 * Used for `CORS_ORIGINS`, which can contain multiple URLs
 * separated by commas.
 *
 * @param {string|undefined} value - The raw CSV string
 * @returns {string[]} Array of trimmed strings, or empty array
 *
 * @example
 * splitCsv('http://a.com, http://b.com') // → ['http://a.com', 'http://b.com']
 * splitCsv('')                            // → []
 * splitCsv(undefined)                     // → []
 */
const splitCsv = (value) =>
  value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

// ----------------------------------------------------------------------
// Application Environment
// ----------------------------------------------------------------------

/**
 * Current Node.js environment.
 *
 * Typically one of:
 * - `'development'` — Local development.
 * - `'production'`  — Deployed to production.
 * - `'test'`        — Running automated tests.
 *
 * Defaults to `'development'` for safety — if `NODE_ENV` is
 * not set, we assume development, which enables more verbose
 * logging and relaxed validation.
 */
export const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Convenience boolean for production checks.
 *
 * Used throughout the codebase to toggle behaviour:
 * - Logging format (dev vs. combined).
 * - Error detail in responses.
 * - Production‑only validation.
 */
export const IS_PRODUCTION = NODE_ENV === 'production';

// ----------------------------------------------------------------------
// Server
// ----------------------------------------------------------------------

/** Port the server listens on. Defaults to 5001. */
export const PORT = parsePort(process.env.PORT, 5001);

/** MongoDB connection URI. Required in production. */
export const MONGO_URI = process.env.MONGO_URI;

// ----------------------------------------------------------------------
// JWT Authentication
// ----------------------------------------------------------------------

/**
 * Secret key for signing access tokens.
 *
 * Must be a long, random string. Generate with:
 *   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
 */
export const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;

/**
 * Secret key for signing refresh tokens.
 *
 * Should be different from `JWT_ACCESS_SECRET` so a compromised
 * access token secret doesn't compromise refresh tokens.
 */
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

/**
 * Access token expiry duration.
 *
 * Shorter lifetimes reduce the window for stolen token misuse.
 * The client refreshes transparently via the refresh token.
 *
 * Default: 15 minutes.
 */
export const ACCESS_TOKEN_EXPIRE =
  process.env.ACCESS_TOKEN_EXPIRE || '15m';

/**
 * Refresh token expiry duration.
 *
 * Longer than access tokens — users stay logged in for this
 * duration without re‑authenticating.
 *
 * Default: 7 days.
 */
export const REFRESH_TOKEN_EXPIRE =
  process.env.REFRESH_TOKEN_EXPIRE || '7d';

// ----------------------------------------------------------------------
// Google OAuth
// ----------------------------------------------------------------------

/**
 * Google OAuth 2.0 credentials.
 *
 * Obtained from the Google Cloud Console under
 * "APIs & Services" → "Credentials".
 *
 * These are optional in development (OAuth routes return 503
 * if not configured) but required in production if Google
 * sign‑in is offered.
 */
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

/**
 * Google OAuth callback URL.
 *
 * Must match the authorised redirect URI configured in the
 * Google Cloud Console. Typically:
 *   http://localhost:5001/api/auth/google/callback (dev)
 *   https://api.example.com/api/auth/google/callback (prod)
 */
export const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;

// ----------------------------------------------------------------------
// Email (for OTP delivery)
// ----------------------------------------------------------------------

/** SMTP server hostname (e.g., smtp.gmail.com). */
export const EMAIL_HOST = process.env.EMAIL_HOST;

/**
 * SMTP server port.
 *
 * Common values:
 * - 587: STARTTLS (recommended).
 * - 465: SSL/TLS (legacy).
 * - 25:  Unencrypted (avoid in production).
 */
export const EMAIL_PORT = parsePort(process.env.EMAIL_PORT, 587);

/** SMTP authentication username (usually the email address). */
export const EMAIL_USER = process.env.EMAIL_USER;

/** SMTP authentication password (or app‑specific password). */
export const EMAIL_PASS = process.env.EMAIL_PASS;

// ----------------------------------------------------------------------
// Client / CORS
// ----------------------------------------------------------------------

/**
 * The URL of the client application.
 *
 * Used for:
 * - CORS origin validation.
 * - OAuth redirect URL construction.
 *
 * Default: Vite's default dev server URL.
 */
export const CLIENT_URL =
  process.env.CLIENT_URL || 'http://localhost:5173';

/**
 * Additional CORS origins as a comma‑separated string.
 *
 * Useful for preview deployments, staging environments,
 * or multiple client URLs.
 *
 * Example `.env`:
 *   CORS_ORIGINS="https://staging.example.com,https://preview.example.com"
 */
export const CORS_ORIGINS = splitCsv(process.env.CORS_ORIGINS);

// ----------------------------------------------------------------------
// Production Validation
// ----------------------------------------------------------------------

/**
 * Variables that must be set in production.
 *
 * If any of these are missing when `NODE_ENV=production`,
 * the server will throw immediately at startup. This is
 * safer than failing later with a cryptic error deep in
 * some module.
 */
const requiredInProduction = {
  MONGO_URI,
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  CLIENT_URL,
};

/**
 * Identify which required variables are missing.
 *
 * `Object.entries` → filter where value is falsy → extract key names.
 */
const missingRequired = Object.entries(requiredInProduction)
  .filter(([, value]) => !value)
  .map(([key]) => key);

/**
 * In production: throw immediately if any required variables
 * are missing. The server cannot operate without these.
 *
 * The error message lists all missing variables so the
 * operator can fix them all at once, rather than one at a time.
 */
if (IS_PRODUCTION && missingRequired.length > 0) {
  throw new Error(
    `Missing required production environment variables: ${missingRequired.join(', ')}`,
  );
}

/**
 * In development: warn about missing variables but don't crash.
 *
 * This allows developers to work on features that don't
 * require every service (e.g., working on chat without
 * MongoDB configured, or working on auth without email).
 *
 * The warning is logged so developers are aware that certain
 * features may not work.
 */
if (!IS_PRODUCTION && missingRequired.length > 0) {
  console.warn(
    `[Config] Missing optional local environment variables: ${missingRequired.join(', ')}`,
  );
}