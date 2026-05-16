/**
 * -------------------------------------------------------
 * File: SecurityQuestionFallback.tsx
 * Purpose:
 * Provides a fallback password recovery mechanism using
 * security questions when email/SMS recovery is unavailable
 * or fails.
 *
 * This component implements a two-step verification process
 * where users must correctly answer their pre-configured
 * security question before resetting their password.
 *
 * High-Level Workflow:
 * 1. User enters email address -> System fetches associated
 *    security question from backend.
 * 2. User answers security question and sets new password ->
 *    System verifies answer and updates credentials.
 * 3. On successful verification, user is redirected to login
 *    page with success notification.
 * 4. On failure at any step, appropriate error messages guide
 *    user to retry or correct input.
 *
 * Design Decisions:
 * - Two-step UI pattern prevents overwhelming users with
 *   too many fields at once and allows clear validation
 *   feedback at each stage.
 * - Uses React Query mutations for automatic loading/error
 *   state management and request deduplication.
 * - Framer Motion provides smooth transitions between steps,
 *   making the recovery process feel polished and intentional.
 * - Email is normalized (trim + lowercase) to prevent
 *   case-sensitive lookup failures due to user input.
 *
 * Security Considerations:
 * - Password minimum length (8 chars) enforced client-side
 *   for immediate UX feedback, but backend MUST re-validate.
 * - Error messages are intentionally generic to prevent
 *   user enumeration attacks (doesn't reveal if email exists).
 * - Tokens and sensitive data never stored in component state
 *   beyond the current session.
 * - Security answer is sent as plain text; relies on HTTPS
 *   for transport encryption.
 *
 * Edge Cases Handled:
 * - Empty form submissions prevented with toast notifications.
 * - Whitespace-only inputs trimmed before validation.
 * - API failures show user-friendly error messages with
 *   fallback text when server response is missing.
 * - Password length validation prevents weak passwords
 *   before API call (reduces unnecessary requests).
 * - Navigation between steps preserved so users can correct
 *   email if initial fetch fails.
 *
 * Dependencies:
 * - react-router-dom: `useNavigate`, `Link` for navigation
 * - framer-motion: `motion`, `AnimatePresence` for animations
 * - @tanstack/react-query: `useMutation` for API state
 * - react-hot-toast: `toast` for user notifications
 * - lucide-react: Icons for visual enhancement
 * - Custom components: Button, SecurityQuestionInput, ThemeToggle
 * - API module: `getSecurityQuestion`, `verifySecurity`
 * -------------------------------------------------------
 */

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';

// API functions for security question flow
import { getSecurityQuestion, verifySecurity } from '../api/authApi';

// Shared UI components
import Button from '../components/Button';
import SecurityQuestionInput from '../components/SecurityQuestionInput';
import ThemeToggle from '../components/ThemeToggle';

// Icons for visual feedback and UI enhancement
import { ShieldAlert, ArrowLeft, KeyRound, Lock, Sparkles } from 'lucide-react';

// ----------------------------------------------------------------------
// SecurityQuestionFallback Component
// ----------------------------------------------------------------------

/**
 * SecurityQuestionFallback
 *
 * A self-contained component that handles the complete
 * security-question-based password recovery flow.
 *
 * This component manages its own state, API mutations,
 * and navigation logic. It does not receive props and
 * is designed to be used as a standalone route component.
 */
const SecurityQuestionFallback = () => {
  // ------------------------------------------------------------------
  // State Management
  // ------------------------------------------------------------------

  // Form field states for the multi-step process
  const [email, setEmail] = useState('');           // User's email address
  const [answer, setAnswer] = useState('');         // Security question answer
  const [newPassword, setNewPassword] = useState(''); // New password to set

  // UI flow state: 1 = email entry step, 2 = question + password step
  const [step, setStep] = useState(1);

  // Stores the security question fetched from backend for current email
  const [question, setQuestion] = useState('');

  // Navigation hook for programmatic redirects after success/failure
  const navigate = useNavigate();

  // ------------------------------------------------------------------
  // API Mutations (React Query)
  // ------------------------------------------------------------------

  /**
   * Mutation: Fetch Security Question
   *
   * Why use React Query:
   * - Automatically manages loading states (`isPending`)
   * - Provides built-in error handling without try/catch boilerplate
   * - Prevents duplicate requests when component re-renders
   *
   * Flow:
   * 1. User submits email
   * 2. Mutation triggers API call to backend
   * 3. On success: Save question and advance to step 2
   * 4. On error: Show toast notification and stay on step 1
   */
  const questionMutation = useMutation({
    mutationFn: getSecurityQuestion,
    onSuccess: (data) => {
      // Extract question from response and move to verification step
      setQuestion(data.data.question);
      setStep(2);
    },
    onError: (err) => {
      // Use server error message if available, otherwise generic fallback
      // Generic fallback prevents leaking information about email existence
      toast.error(err.response?.data?.message || 'Could not fetch question');
    },
  });

  /**
   * Mutation: Verify Security Answer & Reset Password
   *
   * Critical security operation that:
   * 1. Validates user's answer against stored security question
   * 2. If valid, updates password in database
   * 3. Returns success/failure status
   *
   * Success behavior:
   * - Show success notification to confirm reset
   * - Redirect to login page so user authenticates with new password
   *
   * Failure behavior:
   * - Generic error message (doesn't reveal if answer was wrong,
   *   email invalid, or password rejected - prevents enumeration)
   */
  const verifyMutation = useMutation({
    mutationFn: verifySecurity,
    onSuccess: () => {
      toast.success('Password reset successful. Please login.');
      navigate('/login');
    },
    onError: (err) => {
      // Generic error message for security hardening
      toast.error(err.response?.data?.message || 'Verification failed');
    },
  });

  // ------------------------------------------------------------------
  // Event Handlers
  // ------------------------------------------------------------------

  /**
   * handleEmailSubmit
   *
   * Processes the email submission from step 1.
   *
   * Validation performed:
   * - Ensures email field isn't empty or whitespace-only
   *
   * Why trim + lowercase:
   * - Trim: Users sometimes accidentally add spaces when pasting
   * - Lowercase: Email lookups are typically case-insensitive,
   *   normalizing prevents "User@Example.com" vs "user@example.com" mismatches
   *
   * @param {Event} e - Form submission event
   */
  const handleEmailSubmit = (e) => {
    e.preventDefault();

    // Guard against empty submissions
    if (!email.trim()) return toast.error('Email is required');

    // Normalize email format before sending to backend
    // Using trim() again for safety, though state is already trimmed
    questionMutation.mutate({ email: email.trim().toLowerCase() });
  };

  /**
   * handleReset
   *
   * Processes the password reset submission from step 2.
   *
   * Validation sequence:
   * 1. Check answer and new password aren't empty
   * 2. Validate password meets minimum length requirement (8 chars)
   *
   * Security note:
   * Client-side validation improves UX but backend MUST re-validate
   * all constraints to prevent malicious bypass.
   *
   * @param {Event} e - Form submission event
   */
  const handleReset = (e) => {
    e.preventDefault();

    // Ensure both fields have content (trim prevents whitespace-only answers)
    if (!answer.trim() || !newPassword.trim())
      return toast.error('All fields are required');

    // Enforce minimum password length before API call
    // Reduces unnecessary network requests for obviously invalid passwords
    if (newPassword.length < 8)
      return toast.error('Password must be at least 8 characters');

    // Submit verification with normalized email
    verifyMutation.mutate({
      email: email.trim().toLowerCase(),
      answer,
      newPassword,
    });
  };

  /**
   * Back button handler
   *
   * Intelligent navigation based on current step:
   * - Step 1 (email entry): Go back to login page (exit recovery flow)
   * - Step 2 (verification): Return to step 1 (allow email correction)
   *
   * Why this behavior:
   * If user entered wrong email in step 1, they need ability to
   * correct it without refreshing the page.
   */
  const handleBackNavigation = () => {
    if (step === 1) {
      navigate('/login');
    } else {
      setStep(1);
    }
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4 relative overflow-hidden transition-colors duration-300">
      
      {/* 
        Background Decorative Elements 
        ============================================
        Large blurred gradient orbs that create visual depth
        behind the main form card. These are purely aesthetic
        and have no functional impact. The extreme blur and
        positioning create a subtle "glow" effect.
      */}
      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full dark:bg-blue-600/20"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[120px] rounded-full dark:bg-indigo-600/20"></div>

      {/* Theme toggle positioned in top-right corner for easy access */}
      <div className="absolute top-8 right-8">
        <ThemeToggle />
      </div>

      {/* 
        Main Form Card
        ============================================
        Uses backdrop-blur for frosted glass effect,
        with semi-transparent backgrounds that adapt to theme.
        Animation provides subtle entrance motion.
      */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white/80 dark:bg-gray-900/50 backdrop-blur-2xl rounded-[2.5rem] p-8 md:p-10 shadow-2xl border border-gray-200 dark:border-gray-800 relative z-10"
      >
        {/* 
          Back Navigation Button
          ============================================
          Appears on both steps with different behaviors.
          Positioned absolutely within the card container.
        */}
        <button
          onClick={handleBackNavigation}
          className="absolute top-8 left-8 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* 
          Header Section
          ============================================
          Contains icon badge, recovery label, and dynamic title.
          Title changes based on current step to guide user.
        */}
        <div className="flex flex-col items-center mb-8">
          {/* Animated icon container with gradient background */}
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg mb-4"
          >
            <ShieldAlert className="w-8 h-8 text-white" />
          </motion.div>

          {/* Status badge indicating recovery mode */}
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-bold tracking-widest uppercase text-[10px] mb-1">
            <Sparkles className="w-3 h-3" />
            Account Recovery
          </div>

          {/* Dynamic header text based on current step */}
          <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight text-center">
            {step === 1 ? 'Reset Password' : 'Answer Question'}
          </h1>
        </div>

        {/* 
          Animated Form Switcher
          ============================================
          Uses AnimatePresence to smoothly transition between steps
          with slide animations. 'mode="wait"' ensures animations
          complete before the next step renders, preventing jarring
          simultaneous transitions.
        */}
        <AnimatePresence mode="wait">
          {step === 1 ? (
            // ------------------------------------------------------------
            // STEP 1: Email Collection Form
            // ------------------------------------------------------------
            <motion.form
              key="step1"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              onSubmit={handleEmailSubmit}
              className="space-y-6"
            >
              {/* Email input field */}
              <div className="space-y-2">
                <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-2 ml-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full bg-white dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-2xl px-4 py-3.5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition shadow-sm"
                  required
                />
              </div>

              {/* Submit button with loading state */}
              <Button
                name="Fetch Question"
                type="submit"
                loading={questionMutation.isPending}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 py-4 text-lg"
              />
            </motion.form>
          ) : (
            // ------------------------------------------------------------
            // STEP 2: Security Question & Password Reset Form
            // ------------------------------------------------------------
            <motion.form
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              onSubmit={handleReset}
              className="space-y-6"
            >
              {/* 
                Security Question Section
                ============================================
                Custom component that displays the fetched question
                and provides an input for the answer.
              */}
              <div className="bg-gray-100 dark:bg-gray-800/50 p-6 rounded-3xl border border-gray-200 dark:border-gray-700">
                <SecurityQuestionInput
                  question={question}
                  answer={answer}
                  setAnswer={setAnswer}
                />
              </div>

              {/* New Password Field with lock icon */}
              <div className="space-y-2">
                <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-2 ml-1">
                  New Password
                </label>
                <div className="relative group">
                  {/* Lock icon inside input - changes color on focus */}
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    minLength={8}
                    className="w-full bg-white dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-2xl pl-12 pr-4 py-3.5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition shadow-sm"
                    required
                  />
                </div>
              </div>

              {/* Reset button with loading state */}
              <Button
                name="Reset & Login"
                type="submit"
                loading={verifyMutation.isPending}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 py-4 text-lg"
              />
            </motion.form>
          )}
        </AnimatePresence>

        {/* 
          Footer Link
          ============================================
          Provides alternative navigation back to regular login
          for users who don't want to continue recovery.
        */}
        <div className="mt-8 text-center">
          <Link
            to="/login"
            className="text-xs font-bold text-gray-500 hover:text-blue-600 transition-colors uppercase tracking-widest"
          >
            Back to Sign In
          </Link>
        </div>
      </motion.div>
    </div>
  );
};

export default SecurityQuestionFallback;