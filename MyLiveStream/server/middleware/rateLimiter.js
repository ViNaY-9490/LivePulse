/**
 * -------------------------------------------------------
 * File: middleware/rateLimiter.js
 * Purpose:
 * Configures rate limiting for Express routes to protect
 * the API from abuse, brute‑force attacks, and excessive
 * traffic from individual IP addresses.
 *
 * This middleware uses `express-rate-limit` to count
 * requests per IP within a sliding time window and reject
 * those exceeding the configured threshold.
 *
 * Rate Limiters Defined:
 * - `authLimiter` — Strict limit for authentication routes
 *   (login, signup, OTP verification, password reset).
 * - `apiLimiter`  — General limit for all other API routes.
 *
 * Design Decisions:
 * - **Different thresholds for auth vs. general routes:**
 *   Auth endpoints are high‑value targets for brute‑force
 *   attacks, so they have a stricter limit (20 req / 15 min).
 *   General API routes have a higher limit (100 req / min)
 *   to accommodate normal application usage.
 * - **`standardHeaders: true`:** Sends rate limit information
 *   in the standard `RateLimit-Limit`, `RateLimit-Remaining`,
 *   and `RateLimit-Reset` headers. Clients can use these to
 *   adjust their request rate proactively.
 * - **`legacyHeaders: false`:** Disables the deprecated
 *   `X-RateLimit-*` headers to reduce response header bloat.
 * - **Default memory store:** `express-rate-limit` stores
 *   counters in memory by default. This is suitable for
 *   single‑process deployments. For horizontally‑scaled
 *   deployments, replace with a shared store (Redis,
 *   Memcached) via the `store` option.
 *
 * Security Considerations:
 * - Rate limiting by IP is a first line of defence, not
 *   a complete solution. Attackers can bypass IP‑based
 *   limits using botnets or VPNs.
 * - Combine with other protections: account lockout after
 *   N failed attempts, CAPTCHA on repeated failures, and
 *   monitoring for anomalous patterns.
 * - The `authLimiter` should be applied *before* the
 *   authentication middleware to prevent attackers from
 *   probing with valid tokens to circumvent limits.
 *
 * Edge Cases Handled:
 * - **Proxy environments:** If the app runs behind a
 *   reverse proxy (Nginx, Cloudflare, AWS ALB), configure
 *   `trust proxy` in Express and set `validate: { trustProxy: false }`
 *   or use `req.ip` explicitly. The default behaviour reads
 *   `req.ip`, which Express populates from `X-Forwarded-For`
 *   when `trust proxy` is enabled.
 * - **Custom key generators:** The default key is `req.ip`.
 *   For authenticated routes, you may want to rate‑limit
 *   by user ID instead (or in addition) — configure the
 *   `keyGenerator` option per‑limiter.
 *
 * Usage:
 * ```
 * import { authLimiter, apiLimiter } from './middleware/rateLimiter.js';
 *
 * // Apply to a specific route
 * router.post('/login', authLimiter, login);
 *
 * // Apply to all routes in a router
 * router.use(authLimiter);
 * ```
 *
 * Dependencies:
 * - express-rate-limit: Rate limiting middleware for Express
 * -------------------------------------------------------
 */

import rateLimit from 'express-rate-limit';

// ----------------------------------------------------------------------
// Authentication Rate Limiter
// ----------------------------------------------------------------------

/**
 * Strict rate limiter for authentication endpoints.
 *
 * Targets: `/login`, `/signup`, `/verify-otp`,
 * `/verify-login-otp`, `/resend-otp`, `/security-question`,
 * `/verify-security`, `/refresh-token`.
 *
 * Threshold: 20 requests per 15 minutes per IP.
 *
 * Why this strict:
 * Auth endpoints are the most common target for brute‑force
 * and credential‑stuffing attacks. A low limit makes these
 * attacks infeasible while still allowing legitimate users
 * to retry a few times if they make mistakes.
 *
 * Why 15 minutes:
 * Balances user experience (a locked‑out user doesn't wait
 * too long) with security (long enough to slow down
 * automated attacks significantly).
 */
export const authLimiter = rateLimit({
  /**
   * Sliding time window: 15 minutes.
   *
   * The counter resets gradually — requests are counted
   * within this window, not in fixed 15‑minute blocks.
   * This prevents burst‑and‑wait patterns.
   */
  windowMs: 15 * 60 * 1000, // 15 minutes

  /**
   * Maximum requests per IP within the window.
   *
   * 20 requests in 15 minutes allows:
   * - A few login attempts with typos.
   * - Signup + OTP verification + OTP resend.
   * - A password reset flow.
   */
  max: 20,

  /**
   * Error response body sent when the limit is exceeded.
   *
   * The message tells the user how long to wait, which
   * improves UX compared to a generic "rate limited" message.
   */
  message: {
    message:
      'Too many authentication attempts, please try again after 15 minutes',
  },

  /**
   * Send standard `RateLimit-*` headers (RFC‑style).
   *
   * Headers sent:
   * - `RateLimit-Limit`     — The maximum (20).
   * - `RateLimit-Remaining` — How many requests remain.
   * - `RateLimit-Reset`     — When the window resets (Unix timestamp).
   *
   * Clients can read these to implement proactive backoff.
   */
  standardHeaders: true,

  /**
   * Disable the legacy `X-RateLimit-*` headers.
   *
   * These are deprecated and redundant when `standardHeaders`
   * is enabled. Removing them reduces response header size.
   */
  legacyHeaders: false,
});

// ----------------------------------------------------------------------
// General API Rate Limiter
// ----------------------------------------------------------------------

/**
 * General rate limiter for all non‑auth API routes.
 *
 * Targets: `/me`, and any future data endpoints (feeds,
 * profiles, search, etc.).
 *
 * Threshold: 100 requests per minute per IP.
 *
 * Why more permissive:
 * Normal API usage (fetching data, navigating the app)
 * generates more requests than authentication flows.
 * 100 req/min allows smooth operation while still
 * protecting against accidental or intentional overuse.
 *
 * Why 1 minute:
 * A short window allows bursty traffic (e.g., loading a
 * page that makes several API calls) but still throttles
 * sustained abuse.
 */
export const apiLimiter = rateLimit({
  /**
   * Sliding time window: 1 minute.
   */
  windowMs: 1 * 60 * 1000, // 1 minute

  /**
   * Maximum requests per IP within the window.
   *
   * 100 requests per minute allows normal API usage
   * while limiting abuse.
   */
  max: 100,

  /**
   * Error response body sent when the limit is exceeded.
   *
   * The message is brief — for general API routes, the
   * user isn't typically making requests manually, so
   * a detailed message is less important.
   */
  message: {
    message: 'Too many requests, please slow down',
  },

  /**
   * Send standard `RateLimit-*` headers.
   */
  standardHeaders: true,

  /**
   * Disable the legacy `X-RateLimit-*` headers.
   */
  legacyHeaders: false,
});