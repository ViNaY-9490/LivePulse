/**
 * -------------------------------------------------------
 * File: components/ThemeToggle.jsx
 * Purpose:
 * Renders an animated button that toggles between light
 * and dark themes across the entire application.
 *
 * This component is typically placed in the app header or
 * navigation bar to give users immediate, one‑click control
 * over their visual preference.
 *
 * How It Works:
 * - Reads the current theme and a toggle function from
 *   the ThemeContext provider.
 * - Renders a Sun icon in dark mode (indicating "click for
 *   light") and a Moon icon in light mode (indicating
 *   "click for dark"). This is the standard convention:
 *   show the icon representing the mode you'll switch *to*.
 * - The icon rotates 180° on theme change using a spring
 *   animation, providing delightful, non‑jarring feedback.
 *
 * Dependencies:
 * - ../ThemeContext: React context that exposes `theme`
 *   ('light' | 'dark') and `toggleTheme` (function).
 * - framer-motion: For the press interactions and rotation.
 * - lucide-react: For the Sun and Moon SVG icons.
 * -------------------------------------------------------
 */

import React from 'react';
import { motion } from 'framer-motion';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../ThemeContext';

/**
 * ThemeToggle Component
 *
 * A motion‑enhanced button that cycles between application
 * colour schemes (light ↔ dark) via the ThemeContext.
 */
const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <motion.button
      // Subtle hover and press effects to match the app's
      // interactive component language.
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={toggleTheme}
      // Styling adapts to the current theme so the button
      // always contrasts with its background.
      className="p-2 rounded-xl bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 shadow-lg border border-gray-300 dark:border-gray-700 transition-colors"
      // Explicit aria‑label ensures screen readers announce
      // the button's purpose regardless of the icon shown.
      aria-label="Toggle Theme"
    >
      {/* The inner `motion.div` animates the icon rotation.
          Using `initial={false}` prevents the animation from
          running on mount – it only plays when `theme` changes. */}
      <motion.div
        initial={false}
        // Rotate 0° for dark mode (Moon is "home"), 180° for light (Sun).
        // This creates a smooth half‑spin that feels physical and
        // intentional, like flipping a coin.
        animate={{ rotate: theme === 'dark' ? 0 : 180 }}
        // Spring physics give the rotation a natural, bouncy feel
        // without being distracting. Stiffness and damping were
        // tuned by hand; adjust carefully if changing.
        transition={{ type: 'spring', stiffness: 200, damping: 10 }}
      >
        {theme === 'dark' ? (
          // Moon shown in dark mode → user clicks to switch to light
          <Moon className="w-5 h-5" />
        ) : (
          // Sun shown in light mode (with yellow tint) → user clicks to switch to dark
          <Sun className="w-5 h-5 text-yellow-500" />
        )}
      </motion.div>
    </motion.button>
  );
};

export default ThemeToggle;