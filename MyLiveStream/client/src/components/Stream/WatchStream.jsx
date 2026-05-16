/**
 * -------------------------------------------------------
 * File: components/WatchStream.jsx
 * Purpose:
 * The viewer entry point for watching a live stream.
 * Provides a stream‑key input form with server‑side
 * validation, and conditionally renders the full
 * viewing experience (VideoPlayer + StreamSocial) once
 * a valid stream is confirmed.
 *
 * High‑Level Workflow:
 * 1. User enters a stream key (e.g., "live-user-123").
 * 2. On submit, emits `check-stream` to the signalling
 *    server to verify the stream exists and is active.
 * 3. On success, transitions to the active viewing
 *    layout: full‑screen video player + social panel.
 * 4. On failure, displays a styled error toast and
 *    remains on the empty‑state screen.
 *
 * Design Decisions:
 * - Server‑side validation (`check-stream`) prevents
 *   the user from entering a broken viewing state.
 * - A 5‑second timeout prevents the UI from hanging
 *   indefinitely if the server doesn't respond.
 * - The empty state is visually inviting with an
 *   example key to educate new users.
 * - `AnimatePresence` with `mode="wait"` ensures smooth
 *   transitions between the empty state and the active
 *   stream view.
 *
 * Edge Cases Handled:
 * - Empty or whitespace‑only input → submit blocked.
 * - Rapid double‑submit → `isValidating` guard.
 * - Server timeout → `setTimeout` + cleanup.
 * - Stale callback after timeout → `settled` flag.
 * - Duplicate `check-stream` responses → `settled` flag.
 *
 * Dependencies:
 * - ../../SocketContext: For signalling server communication
 * - ./VideoPlayer: The MSE‑based live stream player
 * - ./StreamSocial: Composite social panel (chat + reactions + interactions)
 * - ../ThemeToggle: Light/dark theme switch
 * - react-hot-toast: For error notifications
 * - framer-motion: For page transitions and micro‑animations
 * - lucide-react: For iconography
 * -------------------------------------------------------
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import VideoPlayer from './VideoPlayer';
import StreamSocial from './StreamSocial';
import ThemeToggle from '../ThemeToggle';
import { useSocket } from '../../SocketContext';
import { ArrowLeft, Tv, Search, Info, RefreshCcw } from 'lucide-react';

// ----------------------------------------------------------------------
// WatchStream Component
// ----------------------------------------------------------------------

/**
 * WatchStream
 *
 * The viewer dashboard. Accepts a stream key, validates it
 * against the server, and renders the live viewing interface
 * when a valid stream is found.
 *
 * @param {object} props
 * @param {string} props.username - Display name of the viewer
 * @param {function} props.onBack - Callback to navigate away
 */
const WatchStream = ({ username, onBack }) => {
  const socket = useSocket();

  // --------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------
  const [viewStreamKey, setViewStreamKey] = useState('');
  const [activeStream, setActiveStream] = useState('');
  const [isValidating, setIsValidating] = useState(false);

  // --------------------------------------------------------------------
  // Stream Validation Handler
  // --------------------------------------------------------------------

  /**
   * Validates the entered stream key against the server.
   *
   * Flow:
   * 1. Trims and validates the input.
   * 2. Sets a validating state to prevent duplicate submissions.
   * 3. Starts a 5‑second timeout to handle unresponsive servers.
   * 4. Emits `check-stream` to the signalling server.
   * 5. On `exists: true` → sets `activeStream` to transition to the viewer.
   * 6. On `exists: false` → shows an error toast.
   *
   * The `settled` flag prevents the callback from updating state
   * if the timeout has already fired (avoids React warnings about
   * state updates on unmounted/unexpected paths).
   *
   * @param {React.FormEvent} event - Form submit event
   */
  const handleWatch = (event) => {
    event.preventDefault();
    const key = viewStreamKey.trim();

    // Guard: empty input or already validating.
    if (!key || isValidating) return;

    setIsValidating(true);
    let settled = false;

    // Timeout: if the server doesn't respond within 5 seconds,
    // show an error and reset the validating state.
    const timeout = setTimeout(() => {
      settled = true;
      setIsValidating(false);
      toast.error('Connection timed out. Please try again.', {
        id: 'socket-timeout',
      });
    }, 5000);

    // Emit validation request to the server.
    socket.emit('check-stream', key, (response = {}) => {
      // If the timeout already fired, ignore this callback.
      if (settled) return;

      settled = true;
      clearTimeout(timeout);
      setIsValidating(false);

      if (response.exists) {
        // Stream found – transition to the viewing interface.
        setActiveStream(key);
        return;
      }

      // Stream not found – show a styled error toast.
      toast.error('Stream not found. Please check the key.', {
        style: {
          borderRadius: '1rem',
          background: '#1f2937',
          color: '#fff',
          border: '1px solid #374151',
        },
      });
      setActiveStream('');
    });
  };

  // --------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors duration-300">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* ---------------------------------------------------------------- */}
        {/* Header: Navigation, Title, Stream Key Input, Theme Toggle      */}
        {/* ---------------------------------------------------------------- */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          {/* Left: Back button + title */}
          <div className="flex items-center gap-6">
            <motion.button
              whileHover={{ scale: 1.1, x: -5 }}
              whileTap={{ scale: 0.9 }}
              onClick={onBack}
              className="p-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm text-gray-500 hover:text-blue-600 transition-colors"
            >
              <ArrowLeft className="w-6 h-6" />
            </motion.button>
            <div>
              <h1 className="text-4xl font-black tracking-tight flex items-center gap-3 text-gray-900 dark:text-white">
                Watch Stream
                <Tv className="w-8 h-8 text-blue-500" />
              </h1>
              <p className="text-gray-500 dark:text-gray-400 font-medium">
                Enjoy the show, {username}!
              </p>
            </div>
          </div>

          {/* Right: Stream key form + theme toggle */}
          <div className="flex items-center gap-4">
            <form onSubmit={handleWatch} className="relative group">
              {/* Search icon inside the input */}
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                <Search className="w-5 h-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
              </div>

              <input
                type="text"
                placeholder="Stream Key..."
                value={viewStreamKey}
                disabled={isValidating}
                onChange={(event) => setViewStreamKey(event.target.value)}
                className="w-full md:w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white rounded-2xl py-4 pl-12 pr-28 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 shadow-sm"
              />

              {/* Submit button: shows spinning icon while validating */}
              <button
                type="submit"
                disabled={isValidating || !viewStreamKey.trim()}
                className="absolute right-2 inset-y-2 px-5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-400 dark:disabled:bg-gray-800 text-white font-black rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20"
              >
                {isValidating ? (
                  <motion.span
                    // Infinite spin animation while validating
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1 }}
                  >
                    <RefreshCcw className="w-4 h-4" />
                  </motion.span>
                ) : (
                  'Join'
                )}
              </button>
            </form>
            <ThemeToggle />
          </div>
        </header>

        {/* ---------------------------------------------------------------- */}
        {/* Main Content: Conditional rendering based on activeStream      */}
        {/* ---------------------------------------------------------------- */}
        <AnimatePresence mode="wait">
          {activeStream ? (
            /* ---- Active Stream View ---- */
            <motion.div
              key="stream-view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-12"
            >
              {/* Video player with decorative border */}
              <div className="relative rounded-[3rem] overflow-hidden shadow-2xl border-8 border-white dark:border-gray-900 bg-black aspect-video">
                <VideoPlayer streamId={activeStream} />
              </div>

              {/* Social panel (chat + reactions + interactions) */}
              <StreamSocial streamId={activeStream} username={username} />
            </motion.div>
          ) : (
            /* ---- Empty State: No active stream ---- */
            <motion.div
              key="empty-view"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center py-32 bg-white/50 dark:bg-gray-900/20 backdrop-blur-sm border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-[4rem] text-center px-6 transition-all hover:bg-white/80 dark:hover:bg-gray-900/30"
            >
              {/* Large TV icon as a visual anchor */}
              <div className="bg-white dark:bg-gray-900 p-8 rounded-[2.5rem] mb-8 shadow-2xl ring-1 ring-gray-100 dark:ring-white/5">
                <Tv className="w-20 h-20 text-gray-300 dark:text-gray-700" />
              </div>

              <h2 className="text-3xl font-black text-gray-900 dark:text-white mb-3">
                Ready to Watch?
              </h2>
              <p className="text-gray-500 dark:text-gray-400 max-w-sm mx-auto mb-10 text-lg font-medium">
                Enter a unique stream key in the search bar above to connect
                to a live broadcast instantly.
              </p>

              {/* Example key chip – educates new users on the expected format */}
              <div className="flex items-center gap-3 p-3 bg-gray-100 dark:bg-gray-900 rounded-[2rem] border border-gray-200 dark:border-gray-800">
                <Info className="w-5 h-5 text-blue-500 ml-2" />
                <div className="px-5 py-2 bg-white dark:bg-gray-800 rounded-2xl text-sm font-mono font-bold text-gray-600 dark:text-gray-300 shadow-sm">
                  live-user-123
                </div>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest mr-2">
                  Example Key
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default WatchStream;