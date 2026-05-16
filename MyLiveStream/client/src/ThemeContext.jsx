/**
 * -------------------------------------------------------
 * File: ThemeContext.jsx
 * Purpose:
 * Provides application‑wide theme management (light/dark
 * mode) via React Context. Persists the user's preference
 * to `localStorage` and applies the corresponding Tailwind
 * `dark` class to the `<html>` element.
 *
 * This context is consumed by the `ThemeToggle` component
 * and any other component that needs to read or change
 * the current theme.
 *
 * High‑Level Architecture:
 * 1. On mount, reads the saved theme from `localStorage`
 *    (defaulting to `'dark'` if nothing is stored).
 * 2. A `useEffect` synchronises the DOM: adds or removes
 *    the `dark` class on `<html>`, which activates Tailwind's
 *    dark mode variants (`dark:bg-gray-900`, etc.).
 * 3. `toggleTheme` flips between `'light'` and `'dark'`,
 *    updating both React state and `localStorage`.
 * 4. The context value `{ theme, toggleTheme }` is made
 *    available to the entire component tree.
 *
 * Design Decisions:
 * - **`localStorage` as the persistence layer:** Theme
 *   preference is a user setting, not session data. It
 *   should survive page refreshes and browser restarts.
 * - **Tailwind `class` strategy (not `media` strategy):**
 *   The `dark` class is manually toggled on `<html>`. This
 *   gives the application full control over the theme,
 *   rather than relying on the OS preference alone. Users
 *   can override their system setting.
 * - **Default is `'dark'`:** The application is designed
 *   with a dark‑first aesthetic. The default matches the
 *   visual design language.
 * - **Custom hook `useTheme`:** Encapsulates the context
 *   lookup and provides a clear error if used outside the
 *   provider.
 *
 * Edge Cases Handled:
 * - First visit (no saved theme) → defaults to `'dark'`.
 * - Corrupted `localStorage` value → `useState` initialiser
 *   falls back to `'dark'` if the stored value is anything
 *   other than `'light'`.
 * - Using `useTheme` outside `<ThemeProvider>` → descriptive
 *   error thrown immediately.
 * - Rapid toggling → React batches state updates; each
 *   toggle is applied in sequence.
 *
 * Dependencies:
 * - React: `createContext`, `useContext`, `useEffect`, `useState`
 * -------------------------------------------------------
 */

import React, { createContext, useContext, useEffect, useState } from 'react';

// ----------------------------------------------------------------------
// Context Creation
// ----------------------------------------------------------------------

/**
 * The theme context object.
 *
 * Initialised with `null` so `useTheme` can detect when a
 * component tries to consume it without a provider ancestor.
 */
const ThemeContext = createContext(null);

// ----------------------------------------------------------------------
// ThemeProvider Component
// ----------------------------------------------------------------------

/**
 * ThemeProvider
 *
 * Manages the current theme state and synchronises it with
 * the DOM (`dark` class on `<html>`) and `localStorage`.
 *
 * Must wrap the entire application so that `useTheme()` is
 * available everywhere.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - The component subtree
 */
export const ThemeProvider = ({ children }) => {
  /**
   * Current theme state.
   *
   * Initialised from `localStorage` so the user's preference
   * is restored immediately on page load, avoiding a flash
   * of the wrong theme (FOIT — Flash of Incorrect Theme).
   *
   * Defaults to `'dark'` if no preference is stored or if
   * the stored value is unrecognised. (The `||` operator
   * treats any falsy value — including corrupted data — as
   * a fallback to `'dark'`.)
   */
  const [theme, setTheme] = useState(
    localStorage.getItem('theme') || 'dark',
  );

  /**
   * Synchronises the DOM and `localStorage` whenever the
   * theme changes.
   *
   * Why a `useEffect`:
   * - DOM manipulation (classList) is a side effect and
   *   should not happen during render.
   * - `localStorage.setItem` is also a side effect.
   * - The effect is the single place where the DOM and
   *   storage are kept in sync with React state.
   *
   * Tailwind dark mode:
   * Tailwind's `darkMode: 'class'` configuration (in
   * `tailwind.config.js`) tells it to look for the `dark`
   * class on a parent element (here, `<html>`). All
   * `dark:*` utility classes only apply when this class
   * is present.
   */
  useEffect(() => {
    const root = window.document.documentElement;

    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Persist the preference so it survives page refreshes.
    localStorage.setItem('theme', theme);
  }, [theme]);

  /**
   * Toggles between `'dark'` and `'light'`.
   *
   * Why a separate function (not inline in the button):
   * - Keeps the toggle logic testable in isolation.
   * - Provides a stable function reference if passed to
   *   child components (though the context value object
   *   is recreated each render regardless — this could be
   *   optimised with `useMemo` if performance becomes an
   *   issue).
   *
   * @returns {void}
   */
  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  /**
   * The context value exposed to consumers.
   *
   * Contains:
   * - `theme`: The current theme string (`'light'` | `'dark'`).
   * - `toggleTheme`: Function to flip the theme.
   */
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// ----------------------------------------------------------------------
// Custom Hook: useTheme
// ----------------------------------------------------------------------

/**
 * Returns the current theme context.
 *
 * Why a custom hook instead of using `useContext` directly:
 * - Encapsulates the context lookup so components don't
 *   need to import both `ThemeContext` and `useContext`.
 * - Provides a clear error message if used outside the
 *   provider, catching configuration mistakes early.
 * - Makes the intent explicit: `useTheme()` is more
 *   readable than `useContext(ThemeContext)`.
 *
 * @returns {{ theme: 'light' | 'dark', toggleTheme: () => void }}
 * @throws {Error} If called outside a `<ThemeProvider>`
 *
 * @example
 * const { theme, toggleTheme } = useTheme();
 * console.log(theme); // 'dark'
 * toggleTheme();      // switches to 'light'
 */
export const useTheme = () => {
  const context = useContext(ThemeContext);

  /**
   * If `context` is null, the component is not wrapped in
   * a `<ThemeProvider>`. This is always a configuration
   * mistake — throw a descriptive error immediately so
   * the developer knows exactly what to fix.
   */
  if (!context) {
    throw new Error(
      'useTheme must be used within a <ThemeProvider>. ' +
        'Wrap a parent component in <ThemeProvider> to fix this.',
    );
  }

  return context;
};