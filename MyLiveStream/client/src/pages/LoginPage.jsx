/**
 * -------------------------------------------------------
 * File: pages/LoginPage.jsx
 * Purpose:
 * Renders the login form for returning users. Handles
 * email/password credential submission, server‑side
 * validation via React Query mutation, and conditional
 * navigation to OTP verification when the backend
 * requires two‑factor authentication.
 *
 * High‑Level Flow:
 * 1. User enters email and password.
 * 2. On submit, `loginMutation` fires a POST to the auth API.
 * 3. On success with `requiresOtp: true`, navigates to the
 *    OTP verification page with the user ID in the query string.
 * 4. On failure, displays a styled error toast.
 *
 * Design Decisions:
 * - Uses `@tanstack/react-query` (`useMutation`) instead of
 *   raw Axios calls. This provides built‑in `isPending` state
 *   for the submit button and standardised error handling.
 * - The background decorations and glassmorphism card match
 *   the Dashboard and other pages for visual consistency.
 * - The "Forgot Password" link navigates to a dedicated
 *   fallback/recovery page rather than an inline flow,
 *   keeping the login form simple.
 *
 * Edge Cases Handled:
 * - Server returns an unexpected error shape → falls back to
 *   generic "Login failed" message.
 * - Network error (no `err.response`) → falls back to generic
 *   message.
 * - Rapid double‑submit → `isPending` disables the button.
 *
 * Dependencies:
 * - ../components/Credentials: Email + password input fields
 * - ../components/Button: Reusable submit button with loading state
 * - ../components/GoogleButton: OAuth redirect button
 * - ../components/ThemeToggle: Light/dark mode toggle
 * - ../api/authApi: `login` API function
 * - react-hot-toast: For error notifications
 * - framer-motion: For entrance and micro‑interactions
 * - lucide-react: For decorative icons
 * -------------------------------------------------------
 */

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import Credentials from '../components/Credentials';
import Button from '../components/Button';
import GoogleButton from '../components/GoogleButton';
import ThemeToggle from '../components/ThemeToggle';
import { login } from '../api/authApi';
import { Sparkles, ShieldCheck } from 'lucide-react';

// ----------------------------------------------------------------------
// LoginPage Component
// ----------------------------------------------------------------------

/**
 * LoginPage
 *
 * The login form page. Collects email and password, submits
 * them to the authentication API, and handles the response
 * (including OTP‑required flows).
 */
const LoginPage = () => {
  // --------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  // --------------------------------------------------------------------
  // Login Mutation (React Query)
  // --------------------------------------------------------------------

  /**
   * Handles the login API call with success/error side effects.
   *
   * Why React Query instead of raw Axios:
   * - `isPending` state is managed automatically, eliminating
   *   manual loading state tracking.
   * - Cache invalidation and retry logic can be added later
   *   without restructuring the component.
   */
  const loginMutation = useMutation({
    mutationFn: login,

    /**
     * On successful login:
     * - If the server requires OTP verification, redirect to
     *   the OTP page with the user ID as a query parameter.
     * - If OTP is not required (e.g., a future password‑only
     *   flow), the server would return an access token directly.
     *   (That path is not yet implemented on the client side.)
     */
    onSuccess: (data) => {
      if (data.data.requiresOtp) {
        navigate(`/verify-otp?userId=${data.data.userId}&type=login`);
      }
      // Future: handle direct token return for non‑OTP flows here.
    },

    /**
     * On error, display a user‑friendly toast.
     * Falls back to a generic message if the server response
     * is missing or malformed.
     */
    onError: (err) =>
      toast.error(err.response?.data?.message || 'Login failed'),
  });

  // --------------------------------------------------------------------
  // Form Submission Handler
  // --------------------------------------------------------------------

  /**
   * Prevents default form behaviour and triggers the login mutation
   * with the current email and password values.
   *
   * @param {React.FormEvent} e - The form submit event
   */
  const handleSubmit = (e) => {
    e.preventDefault();
    loginMutation.mutate({ email, password });
  };

  // --------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4 relative overflow-hidden transition-colors duration-300">
      {/* ---------------------------------------------------------------- */}
      {/* Ambient Background Decorations                                  */}
      {/* ---------------------------------------------------------------- */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full dark:bg-blue-600/20" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full dark:bg-purple-600/20" />

      {/* Theme toggle – positioned absolutely in the top‑right corner */}
      <div className="absolute top-8 right-8">
        <ThemeToggle />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Login Card                                                     */}
      {/* ---------------------------------------------------------------- */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white/80 dark:bg-gray-900/50 backdrop-blur-2xl rounded-[2.5rem] p-8 md:p-10 shadow-2xl border border-gray-200 dark:border-gray-800 relative z-10"
      >
        {/* ---- Header: Icon + Branding ---- */}
        <div className="flex flex-col items-center mb-8">
          <motion.div
            whileHover={{ rotate: -5, scale: 1.05 }}
            className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg mb-4"
          >
            <ShieldCheck className="w-8 h-8 text-white" />
          </motion.div>
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-bold tracking-widest uppercase text-[10px] mb-1">
            <Sparkles className="w-3 h-3" />
            LivePulse Security
          </div>
          <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">
            Welcome Back
          </h1>
        </div>

        {/* ---- Login Form ---- */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Email + Password fields (login mode: no name/confirm) */}
          <Credentials
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
          />

          {/* Submit button: shows spinner while mutation is pending */}
          <Button
            name="Sign In"
            type="submit"
            loading={loginMutation.isPending}
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500"
          />
        </form>

        {/* ---- Alternative Sign‑In Options ---- */}
        <div className="mt-8 space-y-6">
          {/* Divider: "or continue with" */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200 dark:border-gray-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase tracking-widest font-bold">
              <span className="bg-white dark:bg-gray-900 px-4 text-gray-500">
                or continue with
              </span>
            </div>
          </div>

          {/* Google OAuth button */}
          <GoogleButton />

          {/* ---- Footer Links ---- */}
          <div className="flex flex-col gap-4 text-center">
            <Link
              to="/security-fallback"
              className="text-xs font-bold text-gray-500 hover:text-blue-500 transition-colors uppercase tracking-widest"
            >
              Forgot your password?
            </Link>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-600 uppercase tracking-widest">
              New here?{' '}
              <Link
                to="/signup"
                className="text-blue-600 dark:text-blue-500 hover:text-blue-500 dark:hover:text-blue-400 font-black"
              >
                Create Account
              </Link>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;