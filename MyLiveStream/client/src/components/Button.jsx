/**
 * -------------------------------------------------------
 * File: components/Button.jsx
 * Purpose:
 * Reusable primary action button with loading state
 * and subtle micro‑interactions.
 *
 * This component is used across authentication flows,
 * form submissions, and any user‑triggered action where
 * visual feedback (hover, tap, loading) improves UX.
 *
 * Design Decisions:
 * - Uses Framer Motion for animation instead of CSS
 *   transitions to keep interactions smooth and
 *   declarative.
 * - The inline SVG spinner is intentional: it avoids
 *   an extra dependency and keeps the component
 *   self‑contained.
 * - Tailwind utility classes are used for consistent
 *   theming and easy customization via `className`.
 *
 * Important Notes:
 * - The button is disabled during loading to prevent
 *   duplicate submissions.
 * - `className` prop is merged with base styles, allowing
 *   callers to override margins, width, etc.
 * -------------------------------------------------------
 */

import { motion } from 'framer-motion';

/**
 * Button Component
 *
 * Renders a motion‑enhanced <button> with primary styling.
 * Displays a spinner and "Processing..." text when `loading`
 * is true, falling back to the button label otherwise.
 *
 * @param {object} props
 * @param {string} props.name - Visible button text (when not loading)
 * @param {function} props.onClick - Click handler
 * @param {boolean} props.loading - Whether to show spinner & disable
 * @param {string} [props.type="button"] - HTML button type attribute
 * @param {string} [props.className=""] - Additional Tailwind classes
 */
const Button = ({ name, onClick, loading, type = 'button', className = '' }) => (
  <motion.button
    type={type}
    // Subtle scale animation on hover provides tactile feedback
    whileHover={{ scale: 1.02 }}
    // Slight press effect reassures the user the click registered
    whileTap={{ scale: 0.98 }}
    onClick={onClick}
    // Disable interaction while the operation is in progress
    disabled={loading}
    // Base styling: full‑width, indigo primary, rounded corners,
    // smooth transition for background colour, reduced opacity when disabled
    className={`w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-6 rounded-xl transition-all duration-200 disabled:opacity-50 ${className}`}
  >
    {loading ? (
      <span className="flex items-center justify-center gap-2">
        {/* Inline animated spinner – avoids extra dependency */}
        <svg
          className="animate-spin h-5 w-5"
          viewBox="0 0 24 24"
          aria-hidden="true"   // Decorative; the text "Processing..." conveys the status
        >
          {/* Background track */}
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          {/* Animated arc */}
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        {/* Text is intentionally visible for screen readers and sighted users */}
        Processing...
      </span>
    ) : (
      name
    )}
  </motion.button>
);

export default Button;