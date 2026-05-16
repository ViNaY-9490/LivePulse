/**
 * -------------------------------------------------------
 * File: pages/Dashboard.jsx
 * Purpose:
 * The main authenticated landing page for creators and
 * viewers. Acts as the application hub, providing quick
 * access to "Go Live" (broadcast) and "Explore" (watch)
 * workflows, user identity display, theme controls, and
 * session management.
 *
 * This is the first screen users see after logging in.
 * It sets the tone for the application with a polished,
 * modern design and clear calls to action.
 *
 * High‑Level Layout:
 * 1. Ambient background blur decorations (non‑interactive).
 * 2. Header with personalised greeting, user badge, and
 *    theme toggle.
 * 3. Two primary action cards: "Go Live" and "Explore".
 * 4. Footer with logout button and copyright.
 *
 * Design Decisions:
 * - Uses Redux for user state (avoids prop drilling from
 *   a parent layout).
 * - The user's first name is extracted client‑side from
 *   the full name string for a personalised greeting.
 * - Navigation is handled via `react-router-dom`'s
 *   `useNavigate` hook, keeping the component decoupled
 *   from route definitions.
 * - Ambient background blobs use `pointer-events-none`
 *   so they never interfere with button clicks or text
 *   selection.
 *
 * Edge Cases Handled:
 * - User object missing `name` field → falls back to "there".
 * - User object missing `email` field → displays "Unknown user".
 * - Logout clears both Redux state and localStorage tokens
 *   to prevent orphaned credentials.
 *
 * Dependencies:
 * - react-redux: For `useSelector` and `useDispatch`
 * - react-router-dom: For `useNavigate`
 * - ../redux/authSlice: `logout` action creator
 * - ../components/ThemeToggle: Light/dark mode toggle
 * - framer-motion: For entrance animations and micro‑interactions
 * - lucide-react: For iconography
 * -------------------------------------------------------
 */

import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { logout } from '../redux/authSlice';
import { Radio, Tv, LogOut, User, Sparkles } from 'lucide-react';
import ThemeToggle from '../components/ThemeToggle';

// ----------------------------------------------------------------------
// Dashboard Component
// ----------------------------------------------------------------------

/**
 * Dashboard
 *
 * The authenticated home screen. Displays a personalised
 * greeting, navigation cards for the two main workflows,
 * and session management controls.
 */
const Dashboard = () => {
  // --------------------------------------------------------------------
  // Redux & Router Hooks
  // --------------------------------------------------------------------
  const user = useSelector((state) => state.auth.user);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  /**
   * Extract the user's first name for a friendly greeting.
   * Falls back to "there" if the name is unavailable (e.g.,
   * during signup with email only, or a delayed profile fetch).
   */
  const firstName = user?.name?.split(' ')[0] || 'there';

  // --------------------------------------------------------------------
  // Logout Handler
  // --------------------------------------------------------------------

  /**
   * Performs a full session teardown:
   * 1. Removes tokens from localStorage (preventing auto‑login).
   * 2. Dispatches the Redux logout action (clears user state).
   * 3. Redirects to the login page.
   *
   * Why clear both localStorage and Redux:
   * Redux state is ephemeral (lost on refresh), but localStorage
   * persists. If we only cleared Redux, the Axios interceptor
   * would still find the old token and attempt to use it.
   */
  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    dispatch(logout());
    navigate('/login');
  };

  // --------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white transition-colors duration-300">
      {/* ---------------------------------------------------------------- */}
      {/* Ambient Background Decorations                                  */}
      {/* ---------------------------------------------------------------- */}
      {/* Large, blurred coloured circles that create a subtle, modern
          gradient atmosphere. `pointer-events-none` ensures they never
          block interaction with the content layer above. */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/5 blur-[120px] rounded-full dark:bg-blue-600/10" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/5 blur-[120px] rounded-full dark:bg-purple-600/10" />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Content Layer                                                   */}
      {/* ---------------------------------------------------------------- */}
      <div className="relative z-10 max-w-6xl mx-auto px-6 py-12 lg:py-20">
        {/* ---- Header: Greeting, User Badge, Theme Toggle ---- */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-16">
          {/* Left: Animated greeting */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-bold tracking-widest uppercase text-xs">
              <Sparkles className="w-4 h-4" />
              Creator Portal
            </div>
            <h1 className="text-5xl font-black tracking-tight text-gray-900 dark:text-white">
              Welcome, {firstName}!
            </h1>
            <p className="text-gray-500 dark:text-gray-400 max-w-md font-medium">
              Manage your broadcasts, connect with your audience, and watch
              live content from around the world.
            </p>
          </motion.div>

          {/* Right: User badge + theme toggle */}
          <div className="flex items-center gap-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-2 rounded-2xl shadow-xl shadow-gray-200/50 dark:shadow-black/50"
            >
              {/* Avatar placeholder: gradient circle with user icon */}
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                <User className="w-6 h-6 text-white" />
              </div>
              {/* Email display – hidden on very small screens to prevent overflow */}
              <div className="pr-4 hidden sm:block">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1">
                  Authenticated as
                </p>
                <p className="font-bold text-gray-700 dark:text-gray-200 text-sm">
                  {user?.email || 'Unknown user'}
                </p>
              </div>
            </motion.div>
            <ThemeToggle />
          </div>
        </header>

        {/* ---- Action Cards: Go Live + Explore ---- */}
        <main className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          {/* ---------- Go Live Card ---------- */}
          <motion.button
            whileHover={{ y: -10, scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/stream')}
            className="group relative flex flex-col items-start p-10 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[3rem] overflow-hidden transition-all hover:border-blue-500 dark:hover:border-blue-500 hover:shadow-2xl hover:shadow-blue-500/10 text-left shadow-sm"
          >
            {/* Background ghost icon – fades in on hover */}
            <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:opacity-10 transition-opacity dark:text-white">
              <Radio className="w-40 h-40" />
            </div>

            {/* Foreground icon in a blue pill */}
            <div className="mb-10 p-5 bg-blue-600 rounded-[1.5rem] shadow-xl shadow-blue-600/30 group-hover:scale-110 transition-transform">
              <Radio className="w-8 h-8 text-white" />
            </div>

            <h2 className="text-4xl font-black mb-3 text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors tracking-tight">
              Go Live
            </h2>
            <p className="text-gray-500 dark:text-gray-400 font-medium leading-relaxed">
              Broadcast your camera and interact with your audience in real
              time. Fast, stable, and secure.
            </p>

            {/* Call‑to‑action text with animated arrow */}
            <div className="mt-10 flex items-center gap-3 text-sm font-black text-blue-600 dark:text-blue-500 uppercase tracking-widest">
              Launch Studio
              <span className="group-hover:translate-x-2 transition-transform">
                -&gt;
              </span>
            </div>
          </motion.button>

          {/* ---------- Explore Card ---------- */}
          <motion.button
            whileHover={{ y: -10, scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/watch')}
            className="group relative flex flex-col items-start p-10 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[3rem] overflow-hidden transition-all hover:border-purple-500 dark:hover:border-purple-500 hover:shadow-2xl hover:shadow-purple-500/10 text-left shadow-sm"
          >
            {/* Background ghost icon */}
            <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:opacity-10 transition-opacity dark:text-white">
              <Tv className="w-40 h-40" />
            </div>

            {/* Foreground icon in a purple pill */}
            <div className="mb-10 p-5 bg-purple-600 rounded-[1.5rem] shadow-xl shadow-purple-600/30 group-hover:scale-110 transition-transform">
              <Tv className="w-8 h-8 text-white" />
            </div>

            <h2 className="text-4xl font-black mb-3 text-gray-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors tracking-tight">
              Explore
            </h2>
            <p className="text-gray-500 dark:text-gray-400 font-medium leading-relaxed">
              Discover active broadcasters. Enter a stream key and join the
              conversation instantly.
            </p>

            {/* Call‑to‑action text with animated arrow */}
            <div className="mt-10 flex items-center gap-3 text-sm font-black text-purple-600 dark:text-purple-500 uppercase tracking-widest">
              Find Content
              <span className="group-hover:translate-x-2 transition-transform">
                -&gt;
              </span>
            </div>
          </motion.button>
        </main>

        {/* ---- Footer: Logout + Copyright ---- */}
        <footer className="flex flex-col items-center gap-10">
          {/* Logout button: subtle styling until hover, then turns red */}
          <motion.button
            whileHover={{
              scale: 1.05,
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
            }}
            onClick={handleLogout}
            className="flex items-center gap-3 px-10 py-4 bg-white dark:bg-gray-900/50 hover:text-red-600 dark:hover:text-red-500 border border-gray-200 dark:border-gray-800 hover:border-red-200 dark:hover:border-red-900/50 rounded-2xl transition-all font-black uppercase tracking-[0.2em] text-[10px] text-gray-400 shadow-sm"
          >
            <LogOut className="w-4 h-4" />
            Sign Out Session
          </motion.button>

          {/* Copyright – small and unobtrusive */}
          <div className="text-gray-400 dark:text-gray-600 text-[10px] font-black uppercase tracking-[0.3em]">
            &copy; 2026 LivePulse Streaming | Premium Creator Suite
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Dashboard;