/**
 * -------------------------------------------------------
 * File: App.jsx
 * Purpose:
 * The root application component. Handles authentication
 * initialisation, route‑level code splitting, protected
 * route guards, and the global layout shell.
 *
 * This is the entry point for the React component tree.
 * Every page and feature is rendered through this
 * component's routing configuration.
 *
 * High‑Level Workflow:
 * 1. On mount, attempt to restore a saved session from
 *    `localStorage` (tokens) by validating, refreshing if
 *    necessary, and fetching the user profile.
 * 2. While initialising, show a full‑screen spinner.
 * 3. Once ready, render the router with lazy‑loaded pages.
 * 4. Protected routes redirect unauthenticated users to
 *    `/login`. Public routes redirect authenticated users
 *    to `/dashboard`.
 *
 * Design Decisions:
 * - **Lazy loading (`React.lazy` + `Suspense`):** Each page
 *   is a separate code‑split chunk. This reduces the initial
 *   bundle size significantly, especially for heavy pages
 *   like `Streamer` and `WatchStream`.
 * - **Auth restoration in `useEffect`:** Runs once on mount
 *   (`hasInitializedAuthRef` prevents React Strict Mode
 *   double‑invocation in development from re‑running the
 *   logic).
 * - **Token refresh on init:** If the access token is expired
 *   but the refresh token is still valid, a silent refresh
 *   is attempted so the user doesn't have to log in again.
 * - **`localStorage` as token source:** The auth API module
 *   stores tokens there; this component reads them back on
 *   mount to rebuild the Redux state after a page refresh.
 *
 * Edge Cases Handled:
 * - **Expired refresh token:** Immediate logout, no API call.
 * - **Only one token present:** Orphaned state is cleaned up.
 * - **401/403 from `getMe`:** Silently logged out (expected
 *   when tokens are revoked server‑side).
 * - **Network error from `getMe`:** Logged to console but
 *   still forces logout (assumes session is unrecoverable).
 * - **React Strict Mode double‑mount:** `hasInitializedAuthRef`
 *   prevents duplicate initialisation.
 *
 * Dependencies:
 * - react-router-dom: `Routes`, `Route`, `Navigate`, `useNavigate`
 * - react-redux: `useSelector`, `useDispatch`
 * - ./redux/authSlice: `setCredentials`, `logout` actions
 * - ./api/authApi: `clearStoredAuth`, `getMe`, `isJwtExpired`,
 *   `refreshAccessToken`
 * - react-hot-toast: `<Toaster>` for global toast notifications
 * - lucide-react: `Loader2` for the loading spinner
 * -------------------------------------------------------
 */

import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { setCredentials, logout } from './redux/authSlice';
import {
  clearStoredAuth,
  getMe,
  isJwtExpired,
  refreshAccessToken,
} from './api/authApi';
import { Loader2 } from 'lucide-react';
import { Toaster } from 'react-hot-toast';

// ----------------------------------------------------------------------
// Lazy‑Loaded Pages (Code Splitting)
// ----------------------------------------------------------------------

/**
 * Each page is loaded asynchronously via `React.lazy`.
 * This creates separate Webpack/Vite chunks that are only
 * downloaded when the user navigates to that route.
 *
 * Why lazy‑load all pages:
 * - The `Streamer` page includes heavy media APIs (WebRTC,
 *   MediaRecorder). Loading it on every page visit would
 *   waste bandwidth for users who only watch streams.
 * - The `Dashboard` is the most common landing page; splitting
 *   it from the auth pages means unauthenticated users never
 *   download dashboard code.
 * - `LoginPage`, `SignupPage`, and `VerifyOtpPage` are only
 *   needed during the auth flow; they're dead weight for
 *   already‑authenticated users.
 */
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
const VerifyOtpPage = lazy(() => import('./pages/VerifyOtpPage'));
const SecurityQuestionFallback = lazy(() =>
  import('./pages/SecurityQuestionFallback'),
);
const Dashboard = lazy(() => import('./pages/Dashboard'));
const OAuthHandler = lazy(() => import('./pages/OAuthHandler'));
const Streamer = lazy(() => import('./components/Stream/Streamer'));
const WatchStream = lazy(() => import('./components/Stream/WatchStream'));

// ----------------------------------------------------------------------
// Loading Fallback
// ----------------------------------------------------------------------

/**
 * Shown while a lazy‑loaded page chunk is being downloaded
 * and parsed. Uses the same spinner style as the auth
 * initialisation loader for visual consistency.
 */
const PageLoader = () => (
  <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
    <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
  </div>
);

// ----------------------------------------------------------------------
// App Component
// ----------------------------------------------------------------------

/**
 * App
 *
 * The root component. Orchestrates authentication restoration,
 * global layout, and route rendering with code splitting.
 */
function App() {
  // --------------------------------------------------------------------
  // Redux State & Hooks
  // --------------------------------------------------------------------
  const { isAuthenticated, user } = useSelector((state) => state.auth);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // --------------------------------------------------------------------
  // Auth Initialisation State
  // --------------------------------------------------------------------

  /**
   * `isInitializing` gates the entire route tree. While `true`,
   * only the `PageLoader` is shown. This prevents a flash of
   * the login page for users with a valid stored session.
   */
  const [isInitializing, setIsInitializing] = useState(true);

  /**
   * Prevents the auth initialisation effect from running
   * more than once, even if React Strict Mode double‑mounts
   * the component in development.
   *
   * Why a ref instead of an empty dependency array alone:
   * Strict Mode intentionally re‑mounts components. The ref
   * ensures our expensive auth checks (API calls, token
   * decoding) only execute once.
   */
  const hasInitializedAuthRef = useRef(false);

  // --------------------------------------------------------------------
  // Session Restoration Effect
  // --------------------------------------------------------------------

  useEffect(() => {
    // Guard: if we've already run initialisation, skip.
    if (hasInitializedAuthRef.current) return;
    hasInitializedAuthRef.current = true;

    /**
     * Attempts to restore a previously authenticated session
     * from tokens stored in `localStorage`.
     *
     * Steps:
     * 1. Check for stored access and refresh tokens.
     * 2. If both exist:
     *    a. If the refresh token is expired → logout immediately.
     *    b. If the access token is expired → attempt silent refresh.
     *    c. Fetch the user profile via `getMe()`.
     *    d. Dispatch `setCredentials` to hydrate Redux.
     * 3. If only one token exists → cleanup orphaned state.
     * 4. On any error → logout and clear storage.
     * 5. Always set `isInitializing` to `false` at the end.
     */
    const initializeAuth = async () => {
      const token = localStorage.getItem('accessToken');
      const refreshToken = localStorage.getItem('refreshToken');

      // ---- Both tokens present: attempt full restoration ----
      if (token && refreshToken) {
        try {
          // If the refresh token itself is expired, don't bother
          // calling any API — the session is definitively dead.
          if (isJwtExpired(refreshToken, 0)) {
            dispatch(logout());
            clearStoredAuth();
            setIsInitializing(false);
            return;
          }

          // If the access token is expired (or about to expire),
          // try a silent refresh before fetching the user profile.
          if (isJwtExpired(token)) {
            await refreshAccessToken(refreshToken);
          }

          // Fetch the user profile. `getMe` uses the Axios instance,
          // which attaches the (now valid) access token via its
          // request interceptor.
          const { data } = await getMe();

          // Read the tokens again after the potential refresh.
          // `refreshAccessToken` writes new tokens to localStorage,
          // so we must re‑read them to get the latest values.
          const currentAccessToken = localStorage.getItem('accessToken');
          const currentRefreshToken = localStorage.getItem('refreshToken');

          dispatch(
            setCredentials({
              user: data,
              accessToken: currentAccessToken,
              refreshToken: currentRefreshToken,
            }),
          );
        } catch (error) {
          // Silently handle 401/403 — these are expected when the
          // server has revoked the session (e.g., password change).
          // Also suppress `isStoredAuthError` (thrown by the auth
          // module when tokens are missing/expired).
          if (
            ![401, 403].includes(error.response?.status) &&
            !error.isStoredAuthError
          ) {
            console.error('Unable to restore saved session', error);
          }

          // Regardless of the error, the session is unrecoverable.
          dispatch(logout());
          clearStoredAuth();
        }
      } else if (token || refreshToken) {
        // ---- Orphaned token: one exists without the other ----
        // Clean up to prevent the app from getting stuck in a
        // partially authenticated state.
        dispatch(logout());
        clearStoredAuth();
      }

      // Initialisation complete — render the route tree.
      setIsInitializing(false);
    };

    initializeAuth();
  }, [dispatch]);

  // --------------------------------------------------------------------
  // Initialising State: Show Loader
  // --------------------------------------------------------------------

  /**
   * While auth is being restored, only the full‑screen spinner
   * is rendered. This prevents a jarring flash of the login page
   * for returning users who have a valid stored session.
   */
  if (isInitializing) {
    return <PageLoader />;
  }

  // --------------------------------------------------------------------
  // Render: Route Tree
  // --------------------------------------------------------------------
  return (
    <div className="min-h-screen transition-colors duration-300 bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Global toast notification container.
          Positioned in the top‑right corner so it doesn't
          overlap with centered form content. */}
      <Toaster position="top-right" />

      {/* Suspense boundary for lazy‑loaded page chunks.
          Shows `PageLoader` while the chunk downloads and
          the component renders for the first time. */}
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* ---- Public Routes (redirect to dashboard if already logged in) ---- */}
          <Route
            path="/login"
            element={
              !isAuthenticated ? <LoginPage /> : <Navigate to="/dashboard" />
            }
          />
          <Route
            path="/signup"
            element={
              !isAuthenticated ? <SignupPage /> : <Navigate to="/dashboard" />
            }
          />

          {/* ---- Auth Flow Routes (accessible regardless of auth state) ---- */}
          <Route path="/verify-otp" element={<VerifyOtpPage />} />
          <Route
            path="/security-fallback"
            element={<SecurityQuestionFallback />}
          />
          {/* OAuth callback — processes tokens in the URL; no auth guard needed */}
          <Route path="/oauth" element={<OAuthHandler />} />

          {/* ---- Protected Routes (redirect to login if not authenticated) ---- */}
          <Route
            path="/dashboard"
            element={
              isAuthenticated ? <Dashboard /> : <Navigate to="/login" />
            }
          />
          <Route
            path="/stream"
            element={
              isAuthenticated ? (
                <Streamer
                  username={user?.name}
                  onBack={() => navigate('/dashboard')}
                />
              ) : (
                <Navigate to="/login" />
              )
            }
          />
          <Route
            path="/watch"
            element={
              isAuthenticated ? (
                <WatchStream
                  username={user?.name}
                  onBack={() => navigate('/dashboard')}
                />
              ) : (
                <Navigate to="/login" />
              )
            }
          />

          {/* ---- Catch‑All: Redirect unknown paths to login ---- */}
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </Suspense>
    </div>
  );
}

export default App;