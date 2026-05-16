/**
 * -------------------------------------------------------
 * File: config/network.js
 * Purpose:
 * Centralised network configuration for the application.
 * Builds all API and WebSocket URLs from environment
 * variables with sensible local development defaults.
 *
 * This module is the single source of truth for:
 * - Server base URL (with trailing slash normalisation)
 * - Authentication API base URL
 * - Socket.IO connection URL
 * - Media stream WebSocket URL
 * - URL construction helpers (auth endpoint paths,
 *   stream WebSocket query strings)
 *
 * Design Decisions:
 * - All URLs are normalised by removing trailing slashes
 *   to prevent double‑slash issues when concatenating
 *   paths.
 * - The stream WebSocket URL is constructed with query
 *   parameters (`type` and `streamId`) rather than path
 *   segments, keeping the server routing flat and
 *   predictable.
 * - Environment variables use the `VITE_` prefix as
 *   required by Vite for client‑side exposure. Defaults
 *   point to `localhost:5001` for zero‑config local dev.
 *
 * Environment Variables:
 * - `VITE_SERVER_URL` – Base URL for all services
 * - `VITE_AUTH_API_URL` – Override for auth API (defaults to {SERVER_URL}/api/auth)
 * - `VITE_SOCKET_URL` – Override for Socket.IO server (defaults to SERVER_URL)
 * - `VITE_STREAM_WS_URL` – Override for media WebSocket (defaults to WS version of SOCKET_URL)
 *
 * Dependencies:
 * - None (pure functions, relies only on `import.meta.env`)
 * -------------------------------------------------------
 */

// ----------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------

/**
 * Fallback server URL used when no environment variable is set.
 * Assumes the default backend runs locally on port 5001.
 */
const DEFAULT_SERVER_URL = 'https://livepulse-xvp1.onrender.com';

// ----------------------------------------------------------------------
// URL Sanitisation Helpers
// ----------------------------------------------------------------------

/**
 * Removes any trailing slash(es) from a URL string.
 *
 * Why this exists:
 * Concatenating paths like `${base}/api/auth` would produce
 * double slashes if `base` already ends with `/`. Normalising
 * here keeps all URL construction predictable.
 *
 * @param {string} value - A URL string potentially ending with `/`
 * @returns {string} The URL without trailing slashes
 */
const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

/**
 * Converts an HTTP/HTTPS URL to its WebSocket equivalent.
 *
 * - `https://` → `wss://`
 * - `http://`  → `ws://`
 *
 * Why case‑insensitive regex:
 * URL schemes are case‑insensitive per RFC 3986. The `i` flag
 * handles both `HTTPS://` and `https://` without extra logic.
 *
 * @param {string} value - An HTTP(S) URL
 * @returns {string} The WebSocket equivalent
 */
const toWebSocketUrl = (value) =>
  value.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');

// ----------------------------------------------------------------------
// Exported Configuration
// ----------------------------------------------------------------------

/**
 * Base server URL, normalised.
 * Falls back to `http://localhost:5001` in local development.
 */
export const SERVER_URL = trimTrailingSlash(
  import.meta.env.VITE_SERVER_URL || DEFAULT_SERVER_URL,
);

/**
 * Authentication API base URL.
 * Defaults to `{SERVER_URL}/api/auth` if no override is provided.
 */
export const API_AUTH_URL = trimTrailingSlash(
  import.meta.env.VITE_AUTH_API_URL || `${SERVER_URL}/api/auth`,
);

/**
 * Socket.IO connection URL.
 * Defaults to the base server URL (Socket.IO shares the HTTP server).
 */
export const SOCKET_URL = trimTrailingSlash(
  import.meta.env.VITE_SOCKET_URL || SERVER_URL,
);

/**
 * Media stream WebSocket base URL.
 * Defaults to the WebSocket version of `SOCKET_URL`.
 * This is where raw media chunks are sent/received.
 */
export const STREAM_WS_URL = trimTrailingSlash(
  import.meta.env.VITE_STREAM_WS_URL || toWebSocketUrl(SOCKET_URL),
);

// ----------------------------------------------------------------------
// URL Construction Helpers
// ----------------------------------------------------------------------

/**
 * Constructs a full authentication endpoint URL by appending
 * a path to the auth API base URL.
 *
 * Usage:
 *   authEndpoint('/login') → 'https://api.example.com/api/auth/login'
 *
 * @param {string} path - The endpoint path, must start with `/`
 * @returns {string} Full absolute URL for the auth endpoint
 */
export const authEndpoint = (path) => `${API_AUTH_URL}${path}`;

/**
 * Constructs a stream WebSocket URL with query parameters.
 *
 * The server identifies the connection type (`broadcaster` or
 * `viewer`) and the specific stream via these parameters.
 *
 * Usage:
 *   streamWebSocketUrl({ type: 'viewer', streamId: 'abc123' })
 *   → 'wss://stream.example.com/stream?type=viewer&streamId=abc123'
 *
 * @param {object} options
 * @param {'broadcaster' | 'viewer'} options.type - Connection role
 * @param {string} options.streamId - Unique stream identifier
 * @returns {string} Full WebSocket URL with query string
 */
export const streamWebSocketUrl = ({ type, streamId }) => {
  const params = new URLSearchParams({ type, streamId });
  return `${STREAM_WS_URL}/stream?${params.toString()}`;
};