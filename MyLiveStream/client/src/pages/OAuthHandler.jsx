/**
 * -------------------------------------------------------
 * File: pages/OAuthHandler.jsx
 * Purpose:
 * Acts as the callback/redirect target after a successful
 * third‑party OAuth authentication flow (e.g., Google).
 *
 * This page is never visited directly by users. The OAuth
 * provider redirects here with access and refresh tokens
 * embedded in the URL query parameters. This component
 * extracts those tokens, stores them, fetches the user
 * profile, and redirects to the dashboard – all in a
 * single automated effect.
 *
 * High‑Level Flow:
 * 1. Reads `accessToken` and `refreshToken` from the URL.
 * 2. If both tokens are present:
 *    a. Stores them in localStorage.
 *    b. Calls `getMe()` to fetch the authenticated user profile.
 *    c. Dispatches `setCredentials` to populate the Redux store.
 *    d. Navigates to `/dashboard` (replacing history so the
 *       OAuth URL isn't in the back‑stack).
 *    e. On failure, clears tokens and redirects to `/login`.
 * 3. If tokens are missing, redirects immediately to `/login`.
 *
 * Design Decisions:
 * - Tokens are passed via query parameters (not hash fragments
 *   or cookies) because the backend has full control over the
 *   redirect URL construction after OAuth handshake.
 * - `navigate(..., { replace: true })` ensures the OAuth
 *   callback URL is removed from browser history, preventing
 *   accidental re‑execution if the user presses Back.
 * - The component renders a full‑screen loading spinner so
 *   the user sees a smooth transition rather than a blank
 *   page while the profile fetch is in progress.
 *
 * Security Considerations:
 * - Tokens in URL query parameters are visible in browser
 *   history and server logs. This is acceptable because:
 *   a. The tokens are immediately consumed and the URL is
 *      replaced in history.
 *   b. The OAuth flow uses HTTPS, protecting tokens in transit.
 * - On profile fetch failure, tokens are cleared immediately
 *   to prevent the app from getting stuck with orphaned,
 *   potentially invalid credentials.
 *
 * Edge Cases Handled:
 * - Missing tokens in URL → redirects to login immediately.
 * - Profile fetch fails (network error, invalid token) →
 *   clears stored tokens and redirects to login.
 * - Component unmounts before fetch completes → no cleanup
 *   needed (navigation replaces the route).
 *
 * Dependencies:
 * - react-router-dom: `useSearchParams`, `useNavigate`
 * - react-redux: `useDispatch`
 * - ../redux/authSlice: `setCredentials` action
 * - ../api/authApi: `getMe` API function
 * - lucide-react: `Loader2` spinner icon
 * -------------------------------------------------------
 */

import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { setCredentials } from '../redux/authSlice';
import { getMe } from '../api/authApi';
import { Loader2 } from 'lucide-react';

// ----------------------------------------------------------------------
// OAuthHandler Component
// ----------------------------------------------------------------------

/**
 * OAuthHandler
 *
 * An ephemeral page that processes the OAuth callback,
 * stores credentials, fetches the user profile, and
 * redirects to the dashboard (or login on failure).
 *
 * This component has no user interaction – it is fully
 * automated via a `useEffect` on mount.
 */
const OAuthHandler = () => {
  const [params] = useSearchParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // --------------------------------------------------------------------
  // Automated OAuth Processing Effect
  // --------------------------------------------------------------------

  useEffect(() => {
    /**
     * Orchestrates the full OAuth post‑redirect flow.
     *
     * Why inside `useEffect` and not an event handler:
     * The OAuth redirect is a full page navigation; this
     * component mounts fresh with the tokens in the URL.
     * We process them immediately on mount.
     */
    const fetchUser = async () => {
      // Extract tokens from the callback URL.
      const accessToken = params.get('accessToken');
      const refreshToken = params.get('refreshToken');

      // Guard: if either token is missing, the OAuth flow was
      // incomplete or the URL was manipulated. Redirect to login.
      if (!accessToken || !refreshToken) {
        navigate('/login', { replace: true });
        return;
      }

      // Store tokens for the Axios interceptor and future sessions.
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);

      try {
        // Fetch the authenticated user's profile.
        // `getMe()` uses the Axios instance, which will attach
        // the access token we just stored via its request interceptor.
        const { data } = await getMe();

        // Populate the Redux store with user data and tokens.
        // This triggers the authenticated state across the app.
        dispatch(setCredentials({ user: data, accessToken, refreshToken }));

        // Redirect to the dashboard. `replace: true` removes the
        // OAuth callback URL from history so the user can't navigate
        // back to this handler accidentally.
        navigate('/dashboard', { replace: true });
      } catch (err) {
        // Profile fetch failed – the token may be invalid, the
        // server may be unreachable, or the user may not exist.
        console.error('Failed to fetch user after OAuth', err);

        // Clean up stored tokens to prevent the app from attempting
        // to use invalid credentials on subsequent loads.
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');

        // Redirect to login so the user can try again.
        navigate('/login', { replace: true });
      }
    };

    fetchUser();
  }, [params, dispatch, navigate]);

  // --------------------------------------------------------------------
  // Render: Loading Screen
  // --------------------------------------------------------------------

  /**
   * While the async `fetchUser` function runs, the user sees
   * a full‑screen loading state. This typically lasts less
   * than a second (a single API call), but provides a smooth
   * visual transition rather than a jarring flash of content.
   */
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-white">
      {/* Animated spinner icon */}
      <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />

      {/* Pulsing status text – reassures the user that something is happening */}
      <p className="text-gray-400 font-medium tracking-widest uppercase text-sm animate-pulse">
        Completing Authentication...
      </p>
    </div>
  );
};

export default OAuthHandler;