/**
 * -------------------------------------------------------
 * File: api/authApi.js
 * Purpose:
 * Centralised Axios HTTP client for authentication-related
 * API calls. Manages JWT access & refresh tokens via
 * interceptors, including automatic token attachment,
 * transparent refresh on 401 responses, and Redux-driven
 * session cleanup on unrecoverable auth failures.
 *
 * High‑Level Workflow:
 * 1. Axios instance created with baseURL & timeout from
 *    network config.
 * 2. Request interceptor attaches Authorization header if
 *    an access token exists in localStorage.
 * 3. Response interceptor catches 401 errors, attempts a
 *    silent token refresh, replays the original request
 *    with the new token, or forces logout on failure.
 * 4. API endpoint functions export promise‑based methods
 *    for each auth route (login, signup, OTP, etc.).
 *
 * Design Decisions:
 * - **Refresh token deduplication:** A module‑scoped
 *   `refreshPromise` ensures only one refresh request is
 *   in flight at a time. Concurrent 401s will all await
 *   the same promise.
 * - **Token expiry skew (30 seconds):** Tokens are treated
 *   as expired slightly before their true expiry to
 *   prevent race conditions where a request is sent with
 *   a token that expires during transit.
 * - **Skip‑refresh endpoint list:** Certain auth endpoints
 *   (login, signup, OTP verification, etc.) are excluded
 *   from the refresh flow. A 401 from these means the
 *   credentials are genuinely invalid — retrying would
 *   be pointless and could cause infinite loops.
 * - **`isStoredAuthError` flag:** Custom errors thrown by
 *   this module are tagged so callers (like `App.jsx`) can
 *   distinguish them from network errors and handle them
 *   silently.
 *
 * Edge Cases Handled:
 * - Missing or malformed JWT → `decodeJwtPayload` returns
 *   `null`; `isJwtExpired` returns `true`.
 * - Refresh token itself is expired → immediate error with
 *   `isStoredAuthError = true`.
 * - No refresh token in storage → clears auth and logs out.
 * - Refresh API call fails → clears auth and logs out.
 * - Request already retried (`_retry` flag) → skips refresh
 *   to prevent infinite loops.
 *
 * Dependencies:
 * - axios: HTTP client
 * - ../redux/store: Direct store import for dispatching
 *   logout (used in the interceptor, which runs outside
 *   React's component tree).
 * - ../redux/authSlice: `logout` action creator
 * - ../config/network: `API_AUTH_URL`, `authEndpoint` helper
 *
 * Important Notes:
 * - This module assumes a browser environment (`window.atob`
 *   is used for JWT decoding).
 * - `localStorage` is used for token persistence. In a
 *   high‑security context, consider `httpOnly` cookies.
 * - The response interceptor has a direct dependency on
 *   the Redux store. This is intentional — interceptors
 *   run outside React, so `useDispatch` is unavailable.
 * -------------------------------------------------------
 */

import axios from 'axios';
import store from '../redux/store';
import { logout as logoutAction } from '../redux/authSlice';
import { API_AUTH_URL, authEndpoint } from '../config/network';

// ----------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------

/**
 * Token expiry buffer in milliseconds.
 *
 * A token is considered expired if it will expire within
 * this window. This proactive approach prevents race
 * conditions where a request is dispatched with a token
 * that expires milliseconds later, causing a 401 that
 * could have been avoided.
 */
const TOKEN_EXPIRY_SKEW_MS = 30000;

// ----------------------------------------------------------------------
// Module‑Level State
// ----------------------------------------------------------------------

/**
 * Holds the promise for an in‑flight token refresh request.
 *
 * Why a module‑scoped variable:
 * Multiple 401 responses can arrive simultaneously (e.g.,
 * several API calls fire at once after the token expires).
 * This variable ensures only one refresh request is sent;
 * all other 401 handlers wait for the same promise.
 *
 * Reset to `null` in the `.finally()` of the refresh call
 * so the next expiry triggers a fresh refresh.
 */
let refreshPromise = null;

// ----------------------------------------------------------------------
// Axios Instance
// ----------------------------------------------------------------------

/**
 * The core Axios instance pre‑configured for the auth API.
 *
 * - `baseURL`: Points to the auth service (from network config).
 * - `timeout`: 15 seconds — long enough for slower networks
 *   but not so long that the UI hangs indefinitely.
 *
 * All exported endpoint functions use this instance, so
 * interceptors apply to every auth API call automatically.
 */
const API = axios.create({
  baseURL: API_AUTH_URL,
  timeout: 15000,
});

// ----------------------------------------------------------------------
// Local Storage Helpers
// ----------------------------------------------------------------------

/**
 * Removes both access and refresh tokens from localStorage.
 *
 * Called when:
 * - The session is unrecoverable (refresh fails).
 * - The user explicitly logs out.
 * - Orphaned tokens are detected during initialisation.
 *
 * Why a named export:
 * Other modules (`App.jsx`, the Redux slice) also need to
 * clear tokens, and calling this function is safer than
 * duplicating the `localStorage.removeItem` calls.
 */
export const clearStoredAuth = () => {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
};

// ----------------------------------------------------------------------
// Error Factory
// ----------------------------------------------------------------------

/**
 * Creates a custom error indicating the stored auth data
 * is unusable (missing or expired refresh token).
 *
 * The `isStoredAuthError` flag allows callers (e.g., the
 * session restoration logic in `App.jsx`) to distinguish
 * this case from ordinary network errors and handle it
 * silently — a missing refresh token is an expected state
 * after logout, not a bug.
 *
 * @param {string} message - Human‑readable error description
 * @returns {Error} Enhanced error object with `isStoredAuthError = true`
 */
const createStoredAuthError = (message) => {
  const error = new Error(message);
  error.isStoredAuthError = true;
  return error;
};

// ----------------------------------------------------------------------
// JWT Utilities
// ----------------------------------------------------------------------

/**
 * Decodes the payload of a Base64‑URL‑encoded JWT without
 * cryptographic verification.
 *
 * Why this exists:
 * We need to inspect the `exp` claim locally to decide
 * whether a token should be refreshed *before* making a
 * network call. This avoids sending requests that are
 * guaranteed to fail with 401.
 *
 * Important:
 * This function does NOT verify the token's signature.
 * Verification happens server‑side. Client‑side decoding
 * is purely for expiry checks and should never be used
 * for authorisation decisions.
 *
 * Edge cases handled:
 * - Missing or non‑string token → returns `null`.
 * - Token missing the payload segment → returns `null`.
 * - Malformed Base64 → `catch` block returns `null`.
 *
 * @param {string} token - Raw JWT string (header.payload.signature)
 * @returns {object|null} Decoded payload object, or `null` if decoding fails
 */
const decodeJwtPayload = (token) => {
  if (!token || typeof token !== 'string') return null;

  try {
    // JWT parts: header.payload.signature — we want the payload (index 1)
    const payload = token.split('.')[1];
    if (!payload) return null;

    // Convert URL‑safe Base64 to standard Base64 (RFC 7515)
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if the length isn't a multiple of 4
    const padded = normalized.padEnd(
      Math.ceil(normalized.length / 4) * 4,
      '=',
    );
    return JSON.parse(window.atob(padded));
  } catch {
    return null;
  }
};

/**
 * Checks whether a JWT is expired (or will expire within
 * the given skew window).
 *
 * Why a skew:
 * A token that expires in the next few seconds is
 * practically expired because it might not survive a
 * network round‑trip. We proactively treat it as expired
 * to trigger a refresh before the request is sent.
 *
 * @param {string} token - JWT access or refresh token
 * @param {number} [skewMs=TOKEN_EXPIRY_SKEW_MS] - Expiry
 *   buffer in milliseconds. Use 0 for exact expiry check.
 * @returns {boolean} `true` if the token is absent, malformed,
 *   or expired (including within the skew window)
 */
export const isJwtExpired = (token, skewMs = TOKEN_EXPIRY_SKEW_MS) => {
  const payload = decodeJwtPayload(token);
  // If there's no payload or no `exp` claim, treat as expired
  if (!payload?.exp) return true;
  // `exp` is in seconds; convert to milliseconds for comparison
  return payload.exp * 1000 <= Date.now() + skewMs;
};

// ----------------------------------------------------------------------
// Token Refresh Logic
// ----------------------------------------------------------------------

/**
 * Attempts to refresh the access token using the stored
 * refresh token.
 *
 * Behaviour:
 * - Immediately rejects if the refresh token is missing
 *   or exactly expired (skew = 0). We never attempt to
 *   refresh with an already‑expired refresh token.
 * - Deduplicates concurrent calls: if a refresh is already
 *   in flight, subsequent callers receive the same promise
 *   rather than spawning duplicate requests.
 * - On success, stores the new token pair in `localStorage`.
 *
 * @param {string} [refreshToken] - The refresh token to use.
 *   Defaults to the value in `localStorage`.
 * @returns {Promise<{accessToken: string, refreshToken: string}>}
 *   The new token pair from the server.
 * @throws {Error} With `isStoredAuthError = true` if the
 *   refresh token is missing or expired.
 */
export const refreshAccessToken = async (
  refreshToken = localStorage.getItem('refreshToken'),
) => {
  // Fail early if the stored refresh token is missing or
  // already expired. Using skew = 0 ensures we only proceed
  // with tokens that are still valid right now.
  if (!refreshToken || isJwtExpired(refreshToken, 0)) {
    throw createStoredAuthError(
      'Stored refresh token is missing or expired',
    );
  }

  // Deduplicate: if a refresh is already in progress, wait
  // for its result instead of starting a second request.
  if (!refreshPromise) {
    refreshPromise = axios
      .post(authEndpoint('/refresh-token'), { refreshToken })
      .finally(() => {
        // Clear the shared promise once settled (success or
        // error) so the next refresh can proceed fresh.
        refreshPromise = null;
      });
  }

  const { data } = await refreshPromise;
  // Store the new tokens so the interceptor uses them on
  // subsequent requests and they survive page refreshes.
  localStorage.setItem('accessToken', data.accessToken);
  localStorage.setItem('refreshToken', data.refreshToken);
  return data;
};

// ----------------------------------------------------------------------
// Request Interceptor
// ----------------------------------------------------------------------

/**
 * Attaches the current access token (if available) as a
 * Bearer token in the Authorization header of every request.
 *
 * Why an interceptor:
 * This centralises token attachment so individual endpoint
 * functions don't need to manually pass headers. Every
 * request made through this `API` instance is automatically
 * authenticated if a token exists.
 *
 * Note:
 * The token is read from `localStorage` on every request,
 * not from Redux. This ensures the interceptor (which runs
 * outside React's component tree) always has the latest
 * token, even after a refresh that updated `localStorage`.
 */
API.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ----------------------------------------------------------------------
// Response Interceptor & 401 Recovery
// ----------------------------------------------------------------------

/**
 * Globally handles 401 Unauthorized responses by attempting
 * a transparent token refresh and retrying the failed request.
 *
 * Why a response interceptor:
 * It centralises the refresh‑and‑retry logic so every API
 * call automatically recovers from an expired access token
 * without explicit handling in each component or thunk.
 *
 * Skip‑refresh logic:
 * Certain endpoints (login, signup, OTP verification, etc.)
 * are explicitly excluded from the refresh flow. If one of
 * them returns a 401, it means the credentials are genuinely
 * wrong or the session is invalid — retrying with a new
 * token is pointless and could create infinite loops.
 *
 * The `_retry` flag:
 * After the first 401 and successful refresh, the original
 * request is replayed with `_retry = true`. If that retry
 * also returns 401, the interceptor bails out to prevent
 * infinite refresh‑and‑retry cycles.
 */
API.interceptors.response.use(
  // Success handler — simply pass through successful responses
  (res) => res,

  // Error handler
  async (err) => {
    const originalRequest = err.config;
    const requestPath = originalRequest?.url || '';

    /**
     * Endpoints that should never trigger a token refresh.
     *
     * Why each is excluded:
     * - `/login`, `/signup` — These are unauthenticated by
     *   definition. A 401 here means bad credentials.
     * - `/verify-otp`, `/verify-login-otp`, `/resend-otp` —
     *   OTP flows; a 401 means the OTP or session is invalid.
     * - `/security-question`, `/verify-security` — Account
     *   recovery; no active session to refresh.
     * - `/refresh-token` — The refresh endpoint itself.
     *   Refreshing in response to a failed refresh would
     *   create infinite recursion.
     */
    const shouldSkipRefresh = [
      '/login',
      '/verify-login-otp',
      '/verify-otp',
      '/signup',
      '/security-question',
      '/verify-security',
      '/resend-otp',
      '/refresh-token',
    ].some((path) => requestPath.includes(path));

    // Bail out if any of these conditions are met:
    // 1. No request config (shouldn't happen, but defensive).
    // 2. The request is in the skip‑refresh list.
    // 3. The error is not a 401 (e.g., 500, network error).
    // 4. This request has already been retried (`_retry` flag).
    if (
      !originalRequest ||
      shouldSkipRefresh ||
      err.response?.status !== 401 ||
      originalRequest._retry
    ) {
      return Promise.reject(err);
    }

    // Mark this request as retried so we don't loop forever.
    originalRequest._retry = true;
    const refreshToken = localStorage.getItem('refreshToken');

    // If there's no refresh token at all, the session is
    // definitively dead. Clear storage and force logout.
    if (!refreshToken) {
      clearStoredAuth();
      store.dispatch(logoutAction());
      return Promise.reject(err);
    }

    try {
      // Attempt the silent token refresh.
      // May throw if the refresh token is expired or the
      // server rejects the refresh.
      const data = await refreshAccessToken(refreshToken);

      // Update the original request's Authorization header
      // with the new access token and replay it.
      originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
      return API(originalRequest);
    } catch (refreshErr) {
      // Refresh failed — the session is unrecoverable.
      // Clear all stored auth data and force logout so the
      // user is redirected to the login page.
      clearStoredAuth();
      store.dispatch(logoutAction());
      return Promise.reject(refreshErr);
    }
  },
);

// ----------------------------------------------------------------------
// Auth Endpoint Functions
// ----------------------------------------------------------------------

/**
 * Each function below maps to a specific authentication API
 * route. They all use the pre‑configured `API` instance, so
 * interceptors (token attachment, 401 refresh) are applied
 * automatically.
 *
 * Why individual functions instead of a generic `apiCall`:
 * - Explicit function names make the API surface discoverable.
 * - Each function's parameter shape is self‑documenting.
 * - IDEs can auto‑complete the function names.
 */

/** Registers a new user account */
export const signup = (formData) => API.post('/signup', formData);

/** Verifies an OTP during signup or login flow */
export const verifyOtp = (data) => API.post('/verify-otp', data);

/** Requests a new OTP to be sent (email/SMS) */
export const resendOtp = (data) => API.post('/resend-otp', data);

/** Authenticates a user with email and password */
export const login = (formData) => API.post('/login', formData);

/** Verifies an OTP specifically for the login flow */
export const verifyLoginOtp = (data) =>
  API.post('/verify-login-otp', data);

/** Retrieves the user's security question for account recovery */
export const getSecurityQuestion = (data) =>
  API.post('/security-question', data);

/** Verifies the answer to a security question */
export const verifySecurity = (data) =>
  API.post('/verify-security', data);

/** Fetches the authenticated user's profile */
export const getMe = () => API.get('/me');

/**
 * Constructs the full Google OAuth redirect URL.
 *
 * This is not an API call — it returns a string URL that
 * the browser navigates to, initiating the OAuth flow.
 * The auth server handles the redirect and token exchange.
 */
export const googleAuthUrl = authEndpoint('/google');