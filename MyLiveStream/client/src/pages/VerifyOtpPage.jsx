/**
 * -------------------------------------------------------
 * File: VerifyOtpPage.tsx
 * Purpose:
 * Handles email verification through One-Time Password (OTP)
 * for both signup and login authentication flows.
 *
 * This component processes the 6-digit verification code
 * sent to the user's email address, validates it, and
 * completes the authentication process by storing tokens
 * and redirecting to the dashboard.
 *
 * High-Level Workflow:
 * 1. Component mounts with userId from URL query parameters
 * 2. User enters 6-digit OTP received via email
 * 3. On submission, validates OTP format (6 digits)
 * 4. Sends verification request to appropriate endpoint:
 *    - /verify-otp for signup flow
 *    - /verify-login-otp for login flow
 * 5. On success, stores tokens and user data in Redux
 * 6. Redirects to dashboard with success notification
 * 7. On failure, displays error and allows retry
 *
 * Design Decisions:
 * - Single component handles both signup and login OTP flows
 *   (reduces code duplication, maintains consistency)
 * - `type` query parameter determines which API endpoint to use
 * - UserId is required and passed via URL (not stored in state)
 * - Resend functionality allows users to request new OTP
 * - Full-screen overlay prevents interaction during verification
 *
 * Security Considerations:
 * - OTP validation happens server-side; client only validates format
 * - Tokens stored in localStorage (persistent across sessions)
 * - UserId in URL is temporary and validated server-side
 * - OTP expires after configured time (handled by backend)
 * - Resend endpoint is rate-limited on backend
 *
 * Edge Cases Handled:
 * - Missing userId in URL (session expired or direct navigation)
 * - Invalid OTP format (non-6-digit inputs)
 * - OTP verification failure (invalid/expired code)
 * - Resend OTP failure (rate limiting, network errors)
 * - Loading states prevent double submission
 *
 * Dependencies:
 * - react-router-dom: `useSearchParams`, `useNavigate`
 * - react-redux: `useDispatch` for auth state management
 * - framer-motion: `motion`, `AnimatePresence` for animations
 * - @tanstack/react-query: `useMutation` for API state
 * - react-hot-toast: `toast` for user notifications
 * - lucide-react: Icons for visual enhancement
 * - Custom components: OTPInput, Button, ThemeToggle
 * - API module: `verifyOtp`, `verifyLoginOtp`, `resendOtp`
 * - Redux slice: `setCredentials` action
 * -------------------------------------------------------
 */

import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';

// Custom OTP input component with auto-tabbing functionality
import OTPInput from '../components/OTPInput';

// Shared UI components
import Button from '../components/Button';
import ThemeToggle from '../components/ThemeToggle';

// API functions for OTP verification and resend
import { verifyOtp, verifyLoginOtp, resendOtp } from '../api/authApi';

// Redux action to store user authentication state
import { setCredentials } from '../redux/authSlice';

// Icons for visual feedback and UI enhancement
import { Mail, ArrowLeft, Loader2 } from 'lucide-react';

// ----------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------

/**
 * Expected OTP length for verification.
 * Standard 6-digit verification code format.
 */
const OTP_LENGTH = 6;

/**
 * Animation variants for OTP container entrance.
 * Subtle scale animation creates focus on the verification card.
 */
const containerAnimation = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
};

/**
 * Overlay animation for loading state.
 * Smooth fade transitions when showing/hiding verification overlay.
 */
const overlayAnimation = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

// ----------------------------------------------------------------------
// VerifyOtpPage Component
// ----------------------------------------------------------------------

/**
 * VerifyOtpPage
 *
 * OTP verification page that supports both signup and login flows.
 *
 * Why unified component:
 * Both signup and login require OTP verification with identical UX.
 * The only difference is the API endpoint and success behavior.
 * This component abstracts that difference via the `type` parameter.
 *
 * Flow types:
 * - 'signup' (default): User registering new account
 * - 'login': User with 2FA or email verification enabled
 */
const VerifyOtpPage = () => {
  // ------------------------------------------------------------------
  // State Management
  // ------------------------------------------------------------------

  // 6-digit OTP value entered by user
  const [otp, setOtp] = useState('');

  // URL query parameters containing verification context
  const [searchParams] = useSearchParams();

  /**
   * Extract userId from URL - required for verification.
   * Without this, the verification session cannot be identified.
   */
  const userId = searchParams.get('userId');

  /**
   * Determines which verification flow to use.
   * Defaults to 'signup' for backward compatibility.
   * Possible values: 'signup', 'login'
   */
  const type = searchParams.get('type') || 'signup';

  // Redux dispatch for updating auth state after successful verification
  const dispatch = useDispatch();

  // Navigation hook for redirecting to dashboard after success
  const navigate = useNavigate();

  // ------------------------------------------------------------------
  // API Mutations (React Query)
  // ------------------------------------------------------------------

  /**
   * Determine which OTP verification function to use.
   * Different endpoints handle signup vs login verification logic.
   */
  const mutationFn = type === 'login' ? verifyLoginOtp : verifyOtp;

  /**
   * Mutation: Verify OTP
   *
   * Core verification mutation that handles both signup and login flows.
   *
   * Success flow:
   * 1. Extract authentication tokens and user data from response
   * 2. Persist tokens to localStorage for Axios interceptors
   * 3. Dispatch to Redux to update global auth state
   * 4. Show success notification
   * 5. Redirect to dashboard (authenticated area)
   *
   * Why store tokens in both localStorage and Redux:
   * - localStorage: Persists across page refreshes for Axios interceptors
   * - Redux: Provides immediate auth state to all components
   */
  const mutation = useMutation({
    mutationFn: (data) => mutationFn(data),
    onSuccess: (data) => {
      // Destructure authentication response
      const { accessToken, refreshToken, user } = data.data;

      // Store tokens for API authentication (Axios interceptors)
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);

      // Update Redux store to reflect authenticated state
      dispatch(setCredentials({ user, accessToken, refreshToken }));

      // User feedback before redirect
      toast.success('Verified successfully!');

      // Navigate to main application
      navigate('/dashboard');
    },
    onError: (err) => {
      // Generic error message prevents leaking verification details
      toast.error(err.response?.data?.message || 'Invalid OTP');
    },
  });

  /**
   * Mutation: Resend OTP
   *
   * Allows users to request a new verification code if:
   * - Original OTP expired
   * - Email never arrived
   * - User accidentally deleted the email
   *
   * Note: Backend should implement rate limiting to prevent abuse.
   */
  const resendMutation = useMutation({
    mutationFn: resendOtp,
    onSuccess: () => {
      toast.success('A new OTP has been sent to your email address.');
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Unable to resend OTP. Please try again later.');
    },
  });

  // ------------------------------------------------------------------
  // Event Handlers
  // ------------------------------------------------------------------

  /**
   * handleSubmit
   *
   * Processes OTP verification request.
   *
   * Validation sequence:
   * 1. Verify userId exists (session is valid)
   * 2. Validate OTP is exactly 6 digits
   *
   * Security note:
   * Client validates OTP format only. Backend validates:
   * - OTP correctness
   * - OTP expiration
   * - Rate limiting
   * - userId validity
   *
   * @param {Event} e - Form submission event
   */
  const handleSubmit = (e) => {
    e.preventDefault();

    // Guard: Missing userId indicates broken verification flow
    if (!userId) {
      toast.error('Verification session is missing. Please sign in again.');
      return;
    }

    // Validate OTP format before API call
    if (otp.length !== OTP_LENGTH) {
      toast.error(`Please enter a ${OTP_LENGTH}-digit verification code`);
      return;
    }

    // Submit verification request
    mutation.mutate({ userId, otp });
  };

  /**
   * handleResend
   *
   * Requests a new OTP to be sent to user's email.
   *
   * Why separate from verification mutation:
   * - Different endpoint with different business logic
   * - Independent loading states (allows resend while verifying)
   * - Different retry/error handling strategies
   */
  const handleResend = () => {
    // Guard: Missing userId prevents resend attempt
    if (!userId) {
      toast.error('Verification session is missing. Please sign in again.');
      return;
    }

    // Request new OTP with current flow type
    resendMutation.mutate({ userId, type });
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4 relative overflow-hidden transition-colors duration-300">
      
      {/* 
        Background Decorative Elements 
        ============================================
        Creates visual depth with blurred gradient orbs.
        Blue/indigo palette matches the verification theme.
      */}
      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full dark:bg-blue-600/20"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[120px] rounded-full dark:bg-indigo-600/20"></div>

      {/* Theme toggle - consistent positioning across all pages */}
      <div className="absolute top-8 right-8">
        <ThemeToggle />
      </div>

      {/* 
        Main Verification Card
        ============================================
        Subtle scale animation draws attention to the verification form.
      */}
      <motion.div
        initial={containerAnimation.initial}
        animate={containerAnimation.animate}
        className="w-full max-w-md bg-white/80 dark:bg-gray-900/50 backdrop-blur-2xl rounded-[2.5rem] p-8 md:p-10 shadow-2xl border border-gray-200 dark:border-gray-800 relative z-10"
      >
        {/* 
          Back Navigation Button
          ============================================
          Returns to login page - useful if user navigated here by mistake
          or wants to try a different account.
        */}
        <button
          onClick={() => navigate('/login')}
          className="absolute top-8 left-8 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors"
          aria-label="Go back to login"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* 
          Header Section
          ============================================
          Contains animated email icon and descriptive text.
          Icon animation creates a subtle "drop-in" effect.
        */}
        <div className="flex flex-col items-center mb-8">
          <motion.div
            initial={{ y: -20 }}
            animate={{ y: 0 }}
            className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg mb-4"
          >
            <Mail className="w-8 h-8 text-white" />
          </motion.div>

          <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">
            Verify Email
          </h1>

          <p className="text-gray-500 dark:text-gray-400 mt-2 text-center text-sm">
            We've sent a {OTP_LENGTH}-digit verification code to your email address.
          </p>
        </div>

        {/* 
          OTP Input Form
          ============================================
          Custom OTPInput component handles digit-by-digit entry
          with automatic field progression.
        */}
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* 
            OTP Input Component
            ============================================
            Provides 6 individual input boxes that auto-advance
            when digits are entered. Improves mobile UX significantly.
          */}
          <div className="py-4">
            <OTPInput onChange={setOtp} />
          </div>

          {/* Submit button with loading state */}
          <Button
            name="Verify & Continue"
            type="submit"
            loading={mutation.isPending}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 py-4 text-lg font-bold"
          />
        </form>

        {/* 
          Resend OTP Link
          ============================================
          Allows users to request new verification code.
          Disabled while resend request is in flight to prevent spam.
        */}
        <div className="mt-8 text-center">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-600 uppercase tracking-widest">
            Didn't receive the code?{' '}
            <button
              type="button"
              onClick={handleResend}
              disabled={resendMutation.isPending}
              className="text-blue-600 dark:text-blue-500 hover:underline font-black ml-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resendMutation.isPending ? 'Sending...' : 'Resend OTP'}
            </button>
          </p>
        </div>

        {/* 
          Verification Overlay
          ============================================
          Full-card overlay shown during OTP verification.
          Prevents user interaction while request is processing
          and provides visual feedback that verification is happening.
          
          Why overlay instead of just disabling inputs:
          - Prevents accidental resend clicks during verification
          - Provides stronger visual feedback
          - Blocks all form interactions cleanly
        */}
        <AnimatePresence>
          {mutation.isPending && (
            <motion.div
              initial={overlayAnimation.initial}
              animate={overlayAnimation.animate}
              exit={overlayAnimation.exit}
              className="absolute inset-0 bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm rounded-[2.5rem] flex flex-col items-center justify-center z-20"
            >
              {/* Animated spinner */}
              <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />

              {/* Status text */}
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                Verifying...
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default VerifyOtpPage;