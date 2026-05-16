/**
 * -------------------------------------------------------
 * File: redux/authSlice.js
 * Purpose:
 * Manages authentication state throughout the application
 * using Redux Toolkit. Stores user information,
 * authentication tokens, and session status.
 *
 * This slice is the single source of truth for:
 * - Whether a user is logged in (`isAuthenticated`)
 * - Current user profile data
 * - Access and refresh tokens for API authentication
 * - Loading state during async auth operations
 *
 * High‑Level Workflow:
 * 1. On successful login/verification: dispatch `setCredentials()`
 * 2. Redux store updates with user data and tokens
 * 3. Protected components check `isAuthenticated` for access control
 * 4. Axios interceptors read tokens from `localStorage`
 * 5. On logout: dispatch `logout()` to clear all auth state
 *
 * Design Decisions:
 * - Uses Redux Toolkit's `createSlice` for immutable state
 *   updates (Immer handles immutability internally).
 * - Tokens are stored in Redux for component access *and*
 *   in `localStorage` for Axios interceptors on page refresh.
 * - `isAuthenticated` is an explicit boolean derived from the
 *   presence of both user and token, making conditional UI
 *   rendering simpler and less error‑prone than checking
 *   multiple fields individually.
 * - A separate `loading` flag prevents duplicate async auth
 *   requests and powers loading spinners.
 *
 * Security Considerations:
 * - Tokens in Redux state are ephemeral — cleared on logout
 *   and page refresh.
 * - Avoid logging tokens to the console in production.
 * - The `isAuthenticated` flag gates protected routes,
 *   preventing UI flashes of restricted content.
 *
 * Edge Cases Handled:
 * - Partial state (e.g., token without user) is avoided by
 *   updating all fields atomically in `setCredentials`.
 * - `logout` clears every auth field, leaving no orphaned data.
 * - `loading` flag prevents rapid double‑submissions of
 *   login/verification requests.
 *
 * Dependencies:
 * - @reduxjs/toolkit: `createSlice` for state management
 * -------------------------------------------------------
 */

import { createSlice } from '@reduxjs/toolkit';

// ----------------------------------------------------------------------
// Initial State
// ----------------------------------------------------------------------

/**
 * Default authentication state — fully logged out.
 *
 * Why each field starts this way:
 * - `user: null`          → No authenticated user yet.
 * - `accessToken: null`   → No token for API Authorization header.
 * - `refreshToken: null`  → No token for renewing expired access tokens.
 * - `isAuthenticated: false` → Guards will redirect unauthenticated users.
 * - `loading: false`      → UI is interactive; no async auth op in progress.
 */
const initialState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  loading: false,
};

// ----------------------------------------------------------------------
// Auth Slice
// ----------------------------------------------------------------------

/**
 * Authentication Slice
 *
 * Manages user authentication state including credentials,
 * session status, and async operation loading indicators.
 *
 * Why `createSlice`:
 * - Automatically generates action creators and reducers.
 * - Immer handles immutable updates under the hood — no
 *   manual spread operators needed.
 * - Far less boilerplate than traditional Redux.
 *
 * Reducers:
 * - `setCredentials` — Establishes an authenticated session.
 * - `logout`          — Completely clears all auth data.
 * - `setLoading`      — Toggles the loading flag for async ops.
 */
const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    /**
     * Establishes an authenticated session by setting the user
     * profile and both tokens atomically.
     *
     * Why this exists:
     * Every auth flow (email login, OTP verification, OAuth callback)
     * calls this single reducer, guaranteeing a consistent state shape
     * no matter how the user authenticated.
     *
     * Called after:
     * - Successful email/password login
     * - OTP verification completion
     * - OAuth callback processing
     *
     * Important:
     * All three fields (user, accessToken, refreshToken) are set
     * together to prevent partial authentication states where,
     * for example, a token exists but the user object is still null.
     *
     * @param {object} state  - Current auth state (draft, mutable via Immer)
     * @param {object} action - Redux action
     * @param {object} action.payload - Contains user, accessToken, refreshToken
     * @param {object} action.payload.user - Authenticated user profile
     * @param {string} action.payload.accessToken - JWT access token
     * @param {string} action.payload.refreshToken - JWT refresh token
     */
    setCredentials: (state, action) => {
      const { user, accessToken, refreshToken } = action.payload;

      // Update all auth fields together — prevents partial states
      // where, for example, a token exists but the user is null.
      state.user = user;
      state.accessToken = accessToken;
      state.refreshToken = refreshToken;
      state.isAuthenticated = true;

      // `loading` is intentionally left unchanged here.
      // The caller (thunk or component) manages it via `setLoading`.
    },

    /**
     * Completely clears all authentication state, logging the
     * user out immediately.
     *
     * Why clear every field:
     * - Prevents stale user data from persisting after logout.
     * - Ensures `isAuthenticated` accurately reflects reality.
     * - Avoids accidental API calls with invalid/expired tokens
     *   that might still be in memory.
     *
     * Called when:
     * - User explicitly clicks "Sign Out"
     * - Token refresh fails and the session is unrecoverable
     * - The API returns a definitive 401 Unauthorized
     *
     * Important:
     * `loading` is intentionally NOT reset here. Toggling
     * `loading` to `false` during logout can cause brief UI
     * flickering. The component triggering logout should
     * manage loading state separately.
     *
     * @param {object} state - Current auth state (draft)
     */
    logout: (state) => {
      // Reset every auth field back to its initial value.
      // This is exhaustive — no field is left with stale data.
      state.user = null;
      state.accessToken = null;
      state.refreshToken = null;
      state.isAuthenticated = false;

      // `loading` intentionally NOT reset — see JSDoc above.
    },

    /**
     * Controls the loading flag used by async auth operations
     * (login, OTP verification, OAuth processing).
     *
     * Why a separate reducer:
     * - UI components can show spinners during auth ops.
     * - Prevents double‑submission of login/verification forms
     *   by disabling buttons while `loading` is `true`.
     * - Provides immediate visual feedback to the user.
     *
     * Typical usage pattern:
     * ```
     * dispatch(setLoading(true));   // before async call
     * await someAuthOperation();
     * dispatch(setLoading(false));  // after success or error
     * ```
     *
     * @param {object} state - Current auth state (draft)
     * @param {object} action - Redux action
     * @param {boolean} action.payload - `true` to show loading, `false` to hide
     */
    setLoading: (state, action) => {
      state.loading = action.payload;
    },
  },
});

// ----------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------

/**
 * Action creators — auto‑generated by `createSlice`.
 *
 * Usage examples:
 * ```
 * dispatch(setCredentials({ user, accessToken, refreshToken }));
 * dispatch(logout());
 * dispatch(setLoading(true));
 * ```
 */
export const { setCredentials, logout, setLoading } = authSlice.actions;

/**
 * Auth reducer — included in the root Redux store configuration.
 *
 * Example store setup:
 * ```
 * import { configureStore } from '@reduxjs/toolkit';
 * import authReducer from './redux/authSlice';
 *
 * const store = configureStore({
 *   reducer: {
 *     auth: authReducer,
 *     // ... other reducers
 *   },
 * });
 * ```
 */
export default authSlice.reducer;