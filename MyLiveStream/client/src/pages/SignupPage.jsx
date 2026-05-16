/**
 * -------------------------------------------------------
 * File: SignupPage.tsx
 * Purpose:
 * Handles new user registration with email/password
 * authentication and security question setup.
 *
 * This component collects user credentials and security
 * question answers, then initiates the signup process
 * which triggers an OTP verification flow.
 *
 * High-Level Workflow:
 * 1. User fills in name, email, password (with confirmation)
 * 2. User selects a security question and provides answer
 * 3. On submission, validates all inputs client-side
 * 4. Sends signup request to backend API
 * 5. On success, redirects to OTP verification page
 * 6. On failure, displays appropriate error messages
 *
 * Design Decisions:
 * - Password confirmation field prevents typos before submission
 * - Security questions provide fallback recovery mechanism
 * - Uses React Query mutation for automatic loading/error states
 * - Email is not normalized here (backend handles case-insensitivity)
 * - Gradient theme uses purple-to-blue to differentiate from login
 *
 * Security Considerations:
 * - Password minimum length (8 chars) enforced client-side
 * - Backend MUST re-validate all constraints server-side
 * - Security answer stored as plain text (relies on HTTPS + backend hashing)
 * - OTP verification adds extra layer before account activation
 *
 * Edge Cases Handled:
 * - Empty name field validation
 * - Password/password confirmation mismatch
 * - Password length validation
 * - API error responses with fallback messages
 * - Required fields enforced via HTML5 `required` attribute
 *
 * Dependencies:
 * - react-router-dom: `useNavigate`, `Link` for navigation
 * - framer-motion: `motion` for entrance animations
 * - @tanstack/react-query: `useMutation` for API state
 * - react-hot-toast: `toast` for user notifications
 * - lucide-react: Icons for visual enhancement
 * - Custom components: Credentials, Button, ThemeToggle
 * - API module: `signup` function
 * -------------------------------------------------------
 */

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';

// Custom form component for credential fields (name, email, password)
import Credentials from '../components/Credentials';

// Shared UI components
import Button from '../components/Button';
import ThemeToggle from '../components/ThemeToggle';

// API function for user registration
import { signup } from '../api/authApi';

// Icons for visual enhancement and UX cues
import { Sparkles, UserPlus, HelpCircle, CheckCircle2 } from 'lucide-react';

// ----------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------

/**
 * Minimum password length requirement for security validation.
 * Must match backend validation to ensure consistency.
 */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Predefined security questions for user selection.
 * Provides consistent recovery options across the platform.
 * These questions are intentionally common to ensure users
 * can remember answers years after account creation.
 */
const SECURITY_QUESTIONS = [
  "What is your pet's name?",
  "What is your mother's name?",
  "What city were you born in?",
];

// ----------------------------------------------------------------------
// SignupPage Component
// ----------------------------------------------------------------------

/**
 * SignupPage
 *
 * Complete registration page that collects user information,
 * validates inputs, and initiates the signup process.
 *
 * Why this exists as a separate component:
 * Registration requires more complex validation and additional
 * fields (security questions) compared to login. Separating this
 * logic keeps authentication pages maintainable and focused.
 */
const SignupPage = () => {
  // ------------------------------------------------------------------
  // State Management
  // ------------------------------------------------------------------

  // Core user information
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Security question setup for account recovery
  const [securityQuestion, setSecurityQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [securityAnswer, setSecurityAnswer] = useState('');

  // Navigation hook for redirects after successful signup
  const navigate = useNavigate();

  // ------------------------------------------------------------------
  // API Mutation (React Query)
  // ------------------------------------------------------------------

  /**
   * Mutation: User Signup
   *
   * Why use React Query:
   * - Manages loading state (`isPending`) for button disable/enable
   * - Provides automatic error handling
   * - Handles request deduplication (prevents double-submit)
   *
   * Flow:
   * 1. Send user data to backend
   * 2. On success: Show success toast and redirect to OTP verification
   * 3. On error: Display error message and keep user on signup page
   *
   * Note: The OTP verification step is required before account activation.
   * User ID is passed via URL query parameter for the verification page.
   */
  const signupMutation = useMutation({
    mutationFn: signup,
    onSuccess: (data) => {
      toast.success('OTP sent! Please verify.');
      // Redirect to OTP verification with user ID for the verification process
      navigate(`/verify-otp?userId=${data.data.userId}`);
    },
    onError: (err) => {
      // Use server error message if available, otherwise generic fallback
      toast.error(err.response?.data?.message || 'Signup failed');
    },
  });

  // ------------------------------------------------------------------
  // Event Handlers
  // ------------------------------------------------------------------

  /**
   * handleSubmit
   *
   * Processes the signup form submission with comprehensive validation.
   *
   * Validation sequence:
   * 1. Name field not empty or whitespace-only
   * 2. Password and confirmation match exactly
   * 3. Password meets minimum length requirement
   *
   * Why validate password match client-side:
   * Provides immediate feedback before network request,
   * reducing unnecessary API calls for common user errors.
   *
   * @param {Event} e - Form submission event
   */
  const handleSubmit = (e) => {
    e.preventDefault();

    // Guard against empty name submission
    if (!name.trim()) return toast.error('Name is required');

    // Ensure user hasn't mistyped their password
    if (password !== confirmPassword) return toast.error('Passwords do not match');

    // Enforce minimum password complexity before API call
    if (password.length < MIN_PASSWORD_LENGTH) {
      return toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    // Submit registration data to backend
    signupMutation.mutate({
      name: name.trim(),        // Remove accidental leading/trailing spaces
      email,                    // Email sent as-is (backend handles case-insensitivity)
      password,                 // Raw password (HTTPS ensures encryption in transit)
      securityQuestion,         // Selected question from dropdown
      securityAnswer,           // User's answer (backend should hash before storage)
    });
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center py-12 px-4 relative overflow-hidden transition-colors duration-300">
      
      {/* 
        Background Decorative Elements 
        ============================================
        Large blurred gradient orbs creating visual depth.
        Purple and blue tones differentiate from login page
        (which uses blue/indigo) while maintaining brand consistency.
      */}
      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full dark:bg-purple-600/20"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full dark:bg-blue-600/20"></div>

      {/* Theme toggle - consistent positioning across all auth pages */}
      <div className="absolute top-8 right-8">
        <ThemeToggle />
      </div>

      {/* 
        Main Form Card
        ============================================
        Frosted glass effect with backdrop blur.
        Entrance animation provides smooth page transition.
      */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white/80 dark:bg-gray-900/50 backdrop-blur-2xl rounded-[2.5rem] p-8 md:p-10 shadow-2xl border border-gray-200 dark:border-gray-800 relative z-10"
      >
        {/* 
          Header Section
          ============================================
          Contains animated icon, status badge, and title.
          Hover animation on icon adds playful interaction.
        */}
        <div className="flex flex-col items-center mb-10">
          {/* Animated icon container - rotates slightly on hover */}
          <motion.div
            whileHover={{ rotate: 5, scale: 1.05 }}
            className="w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg mb-4"
          >
            <UserPlus className="w-8 h-8 text-white" />
          </motion.div>

          {/* Status badge indicating signup context */}
          <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-bold tracking-widest uppercase text-[10px] mb-1">
            <Sparkles className="w-3 h-3" />
            Join the community
          </div>

          {/* Main heading */}
          <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight text-center">
            Create Account
          </h1>
        </div>

        {/* 
          Registration Form
          ============================================
          Includes standard credentials plus security question section
        */}
        <form onSubmit={handleSubmit} className="space-y-6">
          
          {/* 
            Credentials Component
            ============================================
            Reusable component that handles name, email, password,
            and password confirmation fields. 'isSignup' prop enables
            the name field which is hidden in login mode.
          */}
          <Credentials
            name={name}
            setName={setName}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            confirmPassword={confirmPassword}
            setConfirmPassword={setConfirmPassword}
            isSignup
          />

          {/* 
            Security Question Section
            ============================================
            Visually grouped in its own card to separate from credentials.
            Users select from predefined questions and provide an answer
            for account recovery purposes.
          */}
          <div className="space-y-4 bg-gray-100 dark:bg-gray-800/30 p-6 rounded-3xl border border-gray-200 dark:border-gray-800">
            
            {/* Security question dropdown */}
            <div>
              <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-2 ml-1">
                <HelpCircle className="w-3 h-3" />
                Security Question
              </label>
              <select
                value={securityQuestion}
                onChange={(e) => setSecurityQuestion(e.target.value)}
                className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl px-4 py-3 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition cursor-pointer"
              >
                {SECURITY_QUESTIONS.map((question) => (
                  <option key={question}>{question}</option>
                ))}
              </select>
            </div>

            {/* Security answer input field */}
            <div>
              <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-2 ml-1">
                <CheckCircle2 className="w-3 h-3" />
                Security Answer
              </label>
              <input
                type="text"
                value={securityAnswer}
                onChange={(e) => setSecurityAnswer(e.target.value)}
                className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl px-4 py-3 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition placeholder:text-gray-400 dark:placeholder:text-gray-700"
                placeholder="Your secure answer"
                required
              />
            </div>
          </div>

          {/* 
            Submit Button
            ============================================
            Shows loading spinner while signup mutation is in progress.
            Gradient styling matches the header icon for visual consistency.
          */}
          <Button
            name="Create Account"
            type="submit"
            loading={signupMutation.isPending}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500"
          />
        </form>

        {/* 
          Footer Link
          ============================================
          Provides navigation to login for existing users.
          Uses uppercase tracking for consistent auth page styling.
        */}
        <div className="mt-8 text-center">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-600 uppercase tracking-widest">
            Already have an account?{' '}
            <Link
              to="/login"
              className="text-purple-600 dark:text-purple-500 hover:text-purple-500 dark:hover:text-purple-400 font-black ml-1"
            >
              Sign In
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default SignupPage;