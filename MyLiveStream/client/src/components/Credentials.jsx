/**
 * -------------------------------------------------------
 * File: components/Credentials.jsx
 * Purpose:
 * Renders a reusable set of credential input fields for
 * authentication forms (login & signup).
 *
 * This component handles:
 * - Display Name (signup only)
 * - Email Address
 * - Password
 * - Confirm Password (signup only)
 *
 * Design Decisions:
 * - Conditionally renders signup‑specific fields based on
 *   the `isSignup` boolean. This keeps the login and signup
 *   flows sharing a single, consistent component.
 * - Framer Motion is used for entrance animation to provide
 *   a polished, modern feel without heavy CSS.
 * - Lucide icons serve as visual cues inside each input,
 *   improving scanability.
 * - Tailwind utility classes provide consistent theming,
 *   including dark mode support.
 * - Inputs include HTML validation attributes (`required`,
 *   `minLength`, `maxLength`, `type="email"`) as a first
 *   line of defence before JavaScript validation.
 *
 * Accessibility Notes:
 * - Labels are explicitly linked via `htmlFor` (not used
 *   here because inputs are nested inside labels implicitly,
 *   but the label elements are present for screen readers).
 * - Icons are decorative and should be hidden from assistive
 *   technology (see inline comment on each icon).
 * -------------------------------------------------------
 */

import { motion } from 'framer-motion';
import { Mail, Lock, ShieldCheck, UserRound } from 'lucide-react';

/**
 * Credentials Component
 *
 * Renders credential input fields for authentication forms.
 * Signup mode shows all four fields; login mode omits
 * Display Name and Confirm Password.
 *
 * @param {object} props
 * @param {string} props.name - Display name value (signup only)
 * @param {function} props.setName - Setter for display name
 * @param {string} props.email - Email value
 * @param {function} props.setEmail - Setter for email
 * @param {string} props.password - Password value
 * @param {function} props.setPassword - Setter for password
 * @param {string} props.confirmPassword - Confirm password value (signup only)
 * @param {function} props.setConfirmPassword - Setter for confirm password
 * @param {boolean} props.isSignup - Whether to show signup‑only fields
 */
const Credentials = ({
  name,
  setName,
  email,
  setEmail,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  isSignup,
}) => (
  <motion.div
    // Subtle entrance animation: fade in + slight upward slide
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    className="space-y-4"
  >
    {/* ------------------------------------------------------------------ */}
    {/* Display Name – only rendered for signup flow                       */}
    {/* ------------------------------------------------------------------ */}
    {isSignup && (
      <div>
        {/* Label with aggressive uppercase + wide tracking for a modern,
            "fashion‑brand" aesthetic. The `ml‑1` nudges alignment with
            the rounded input below. */}
        <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-2 ml-1">
          Display Name
        </label>

        <div className="relative group">
          {/* Decorative icon – absolutely positioned inside the input.
              `group-focus-within` transitions the icon colour to the
              brand blue when the input receives focus. */}
          <div
            className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400 dark:text-gray-600 group-focus-within:text-blue-500 transition-colors"
            aria-hidden="true"
          >
            <UserRound className="w-4 h-4" />
          </div>

          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            // pl‑11 leaves room for the icon (pl‑4 + icon width)
            className="w-full bg-white dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-2xl pl-11 pr-4 py-3 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-700"
            placeholder="Your name"
            maxLength={80}
            required
          />
        </div>
      </div>
    )}

    {/* ------------------------------------------------------------------ */}
    {/* Email Address – always visible                                    */}
    {/* ------------------------------------------------------------------ */}
    <div>
      <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-2 ml-1">
        Email Address
      </label>

      <div className="relative group">
        <div
          className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400 dark:text-gray-600 group-focus-within:text-blue-500 transition-colors"
          aria-hidden="true"
        >
          <Mail className="w-4 h-4" />
        </div>

        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full bg-white dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-2xl pl-11 pr-4 py-3 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-700"
          placeholder="you@example.com"
          required
        />
      </div>
    </div>

    {/* ------------------------------------------------------------------ */}
    {/* Password – always visible                                         */}
    {/* ------------------------------------------------------------------ */}
    <div>
      <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-2 ml-1">
        Password
      </label>

      <div className="relative group">
        <div
          className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400 dark:text-gray-600 group-focus-within:text-blue-500 transition-colors"
          aria-hidden="true"
        >
          <Lock className="w-4 h-4" />
        </div>

        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full bg-white dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-2xl pl-11 pr-4 py-3 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-700"
          placeholder="Password"
          minLength={8}
          required
        />
      </div>
    </div>

    {/* ------------------------------------------------------------------ */}
    {/* Confirm Password – only rendered for signup flow                  */}
    {/* ------------------------------------------------------------------ */}
    {isSignup && (
      <div>
        <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-2 ml-1">
          Confirm Password
        </label>

        <div className="relative group">
          <div
            className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400 dark:text-gray-600 group-focus-within:text-blue-500 transition-colors"
            aria-hidden="true"
          >
            <ShieldCheck className="w-4 h-4" />
          </div>

          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full bg-white dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-2xl pl-11 pr-4 py-3 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-700"
            placeholder="Confirm password"
            minLength={8}
            required
          />
        </div>
      </div>
    )}
  </motion.div>
);

export default Credentials;