/**
 * -------------------------------------------------------
 * File: middleware/common.js
 * Purpose:
 * Provides general‑purpose Express middleware for logging
 * and error handling used across all API routes.
 *
 * These middlewares are not authentication‑specific; they
 * apply to every request regardless of the route or its
 * protection level.
 *
 * Middlewares:
 * - `logger`        — Logs every incoming HTTP request with
 *                     timestamp, method, and URL.
 * - `errorHandler`  — Catches errors forwarded by `next(err)`
 *                     or thrown in async handlers, returning
 *                     a standardised JSON error response.
 *
 * Design Decisions:
 * - **Logging format:** ISO 8601 timestamp + HTTP method +
 *   URL. This is deliberately minimal — a production app
 *   would replace `console.log` with a structured logger
 *   (Winston, Pino) that outputs JSON for log aggregation
 *   services (CloudWatch, Datadog, ELK).
 * - **Error response shape:** All errors return `{ message }`.
 *   A consistent shape makes error handling predictable on
 *   the client side.
 * - **500 obscurity:** For 500 Internal Server Error, the
 *   original error message is replaced with a generic string.
 *   This prevents leaking stack traces, database errors, or
 *   internal paths to the client in production.
 *
 * Security Note:
 * The `errorHandler` intentionally hides internal error
 * details for 500 responses. The original error is still
 * logged to the console (or a logging service) for debugging.
 *
 * Edge Cases Handled:
 * - Error object has no `statusCode` → defaults to 500.
 * - Error object has no `stack` → falls back to `err.message`
 *   for the console log.
 * - Non‑Error objects passed to `next()` → `err.message`
 *   may be undefined; the generic 500 message still applies.
 *
 * Usage:
 * ```
 * import { logger, errorHandler } from './middleware/common.js';
 *
 * // Logger should be the first middleware
 * app.use(logger);
 *
 * // ... routes ...
 *
 * // Error handler must be the LAST middleware
 * app.use(errorHandler);
 * ```
 *
 * Dependencies:
 * - None (pure Express middleware functions)
 * -------------------------------------------------------
 */

// ----------------------------------------------------------------------
// Logger Middleware
// ----------------------------------------------------------------------

/**
 * Logs every incoming HTTP request to the console.
 *
 * This middleware should be registered **before** all route
 * definitions so it captures every request that reaches the
 * server.
 *
 * Why log at the start:
 * Logging at the start of the request lifecycle captures the
 * incoming request regardless of whether it succeeds or fails.
 * If logging were done in each route handler, errors that
 * occur before the handler (e.g., auth middleware) would be
 * missed.
 *
 * Production note:
 * `console.log` is synchronous and blocking — acceptable for
 * development but should be replaced with a structured,
 * asynchronous logger (e.g., Pino, Winston) in production
 * to avoid impacting request throughput.
 *
 * @param {import('express').Request} req  - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next function
 *
 * @example
 * // Logs: [2026-05-16T14:30:00.000Z] POST /api/auth/login
 */
export const logger = (req, res, next) => {
  /**
   * ISO 8601 timestamp for consistent, sortable log entries.
   *
   * Format: `2026-05-16T14:30:00.000Z`
   * This is the standard format used by log aggregation tools.
   */
  const now = new Date().toISOString();

  /**
   * Log format: `[timestamp] METHOD /path`
   *
   * Why only method and URL:
   * Additional data (headers, body, query params) should be
   * logged at the debug level or in a separate middleware
   * to avoid cluttering production logs with sensitive or
   * verbose information.
   */
  console.log(`[${now}] ${req.method} ${req.url}`);

  // Pass control to the next middleware or route handler.
  // Logger is non‑blocking — it must always call `next()`.
  next();
};

// ----------------------------------------------------------------------
// Error Handler Middleware
// ----------------------------------------------------------------------

/**
 * Catches all errors forwarded via `next(err)` or thrown in
 * async handlers (when using `asyncHandler` wrapper).
 *
 * This middleware must be registered **after** all route
 * definitions. Express identifies error‑handling middleware
 * by its four‑parameter signature `(err, req, res, next)`.
 *
 * Why a centralised error handler:
 * - Ensures every error gets a consistent JSON response.
 * - Prevents the server from crashing on unhandled errors.
 * - Keeps error‑response logic DRY (not repeated in every route).
 * - Allows global error logging/monitoring in one place.
 *
 * @param {Error} err  - The error object passed to `next()`
 * @param {import('express').Request} req  - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next function
 *
 * @example
 * // In a route:
 * throw new Error('Something broke');           // → 500
 * throw Object.assign(new Error('Bad input'), { statusCode: 400 }); // → 400
 */
export const errorHandler = (err, req, res, next) => {
  /**
   * Determine the HTTP status code.
   *
   * Priority:
   * 1. `err.statusCode` — Set explicitly by the developer
   *    (e.g., `err.statusCode = 400`).
   * 2. `err.status` — Some libraries (e.g., `createError`)
   *    use `status` instead of `statusCode`.
   * 3. Default to 500 — Anything that reaches the error
   *    handler without a status code is treated as an
   *    internal server error.
   */
  const statusCode = err.statusCode || err.status || 500;

  /**
   * Log the full error details for debugging.
   *
   * Prefer `err.stack` (includes the call trace) over
   * `err.message` (just the error string). Fall back to
   * `err.message` if no stack is available (unlikely for
   * native Error objects).
   *
   * Production note:
   * Replace `console.error` with a structured logger that
   * outputs JSON and includes request context (request ID,
   * user ID, URL) for easier debugging in log aggregation
   * tools.
   */
  console.error(`[Error] ${err.stack || err.message}`);

  /**
   * Send the error response.
   *
   * For 500 errors, the client receives a generic message.
   * This prevents leaking internal details (stack traces,
   * database errors, file paths) that could aid an attacker.
   *
   * For all other status codes (400, 401, 403, 404, etc.),
   * the original error message is returned. These are
   * typically user‑facing messages set deliberately by the
   * developer and are safe to expose.
   */
  res.status(statusCode).json({
    message:
      statusCode === 500
        ? 'Internal Server Error'
        : err.message,
  });
};