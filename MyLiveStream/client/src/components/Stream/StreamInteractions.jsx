/**
 * -------------------------------------------------------
 * File: components/StreamInteractions.jsx
 * Purpose:
 * Renders the interactive reaction bar for a live stream,
 * allowing viewers to like or dislike the current broadcast
 * and see the live viewer count.
 *
 * This component serves as a lightweight audience engagement
 * layer separate from the chat and floating reaction systems.
 * It provides binary feedback (thumbs up / thumbs down) and
 * real‑time viewership metrics.
 *
 * High‑Level Architecture:
 * 1. Joins the stream's WebSocket room on mount.
 * 2. Listens for `update-interactions` events (likes, dislikes,
 *    and the current user's interaction state).
 * 3. Listens for `viewer-count` events (total live viewers).
 * 4. Provides two toggle buttons that emit `toggle-interaction`
 *    events back to the server.
 *
 * Design Decisions:
 * - Interaction state is server‑authoritative: the server
 *   broadcasts the current totals and each user's choice.
 *   This prevents client‑side manipulation and keeps all
 *   viewers in sync.
 * - Buttons use `animate` with a keyframe array (`[1, 1.2, 1]`)
 *   for a "pop" feedback when the user's interaction is
 *   confirmed by the server. The `animate` prop is set to an
 *   empty object when no interaction is active, preventing
 *   continuous animation.
 * - Viewer count is displayed as a stat badge separate from
 *   the interaction buttons to keep the layout scannable.
 *
 * Edge Cases Handled:
 * - Socket or streamId missing → clean no‑op.
 * - Server sends missing or malformed data → defaults to 0.
 * - User rapidly toggles between like/dislike → the server
 *   manages deduplication; the client simply sends intents.
 *
 * Dependencies:
 * - ../../SocketContext: For the Socket.IO client instance
 * - framer-motion: For button animations
 * - lucide-react: For ThumbsUp, ThumbsDown, and Eye icons
 * -------------------------------------------------------
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../../SocketContext';
import { ThumbsUp, ThumbsDown, Eye } from 'lucide-react';
import { motion } from 'framer-motion';

// ----------------------------------------------------------------------
// StreamInteractions Component
// ----------------------------------------------------------------------

/**
 * StreamInteractions
 *
 * A real‑time like/dislike bar with live viewer count for a
 * streaming session. All interaction state is managed by the
 * server and broadcast to all connected clients.
 *
 * @param {object} props
 * @param {string} props.streamId - Unique identifier for the stream
 * @param {string} props.username - Display name of the current viewer
 */
const StreamInteractions = ({ streamId, username }) => {
  const socket = useSocket();

  // --------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------
  const [likes, setLikes] = useState(0);
  const [dislikes, setDislikes] = useState(0);
  const [viewerCount, setViewerCount] = useState(0);

  /**
   * Tracks the current user's interaction for this stream.
   * Possible values: `null` (no interaction), `'like'`, or `'dislike'`.
   * Determined server‑side and broadcast to all clients.
   */
  const [userInteraction, setUserInteraction] = useState(null);

  // --------------------------------------------------------------------
  // WebSocket Lifecycle
  // --------------------------------------------------------------------

  useEffect(() => {
    // Guard: if the socket isn't connected or no stream is active,
    // don't attempt to join or listen.
    if (!socket || !streamId) return undefined;

    /**
     * Receives the full interaction state from the server.
     * Normalises numbers to handle missing or malformed payloads.
     *
     * Expected payload shape:
     * {
     *   likes: number,
     *   dislikes: number,
     *   userInteractions: { [username]: 'like' | 'dislike' }
     * }
     */
    const handleInteractions = (data = {}) => {
      setLikes(Number(data.likes) || 0);
      setDislikes(Number(data.dislikes) || 0);
      setUserInteraction(data.userInteractions?.[username] || null);
    };

    /**
     * Receives the live viewer count from the server.
     * Normalised to a number with a fallback to 0.
     */
    const handleViewerCount = (count) => {
      setViewerCount(Number(count) || 0);
    };

    // Join the stream room and subscribe to interaction events.
    socket.emit('join-stream', streamId);
    socket.on('update-interactions', handleInteractions);
    socket.on('viewer-count', handleViewerCount);

    // Cleanup: unsubscribe on unmount or when dependencies change.
    return () => {
      socket.off('update-interactions', handleInteractions);
      socket.off('viewer-count', handleViewerCount);
    };
  }, [streamId, username, socket]);

  // --------------------------------------------------------------------
  // Interaction Handler
  // --------------------------------------------------------------------

  /**
   * Emits a toggle event for the given interaction type.
   * The server handles deduplication: if the user already
   * has that interaction, it's removed; if they have the
   * opposite interaction, it's switched; otherwise it's added.
   *
   * Wrapped in `useCallback` to maintain referential stability
   * across renders, preventing unnecessary re‑renders of child
   * motion components.
   *
   * @param {'like' | 'dislike'} type - The interaction to toggle
   */
  const handleInteraction = useCallback(
    (type) => {
      socket.emit('toggle-interaction', { streamId, username, type });
    },
    [streamId, username, socket],
  );

  // --------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------
  return (
    <div className="flex flex-wrap items-center justify-between gap-6 py-4">
      {/* Like / Dislike buttons */}
      <div className="flex items-center gap-4">
        {/* ---- Like Button ---- */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          // When the server confirms this user's "like", play a brief
          // pop animation. When interaction is null, `animate` is an
          // empty object so no animation runs.
          animate={
            userInteraction === 'like' ? { scale: [1, 1.2, 1] } : {}
          }
          onClick={() => handleInteraction('like')}
          className={`
            flex items-center gap-2 px-5 py-2.5 rounded-2xl font-bold transition-all duration-300
            ${
              userInteraction === 'like'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30 ring-2 ring-blue-500/50'
                : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
            }
          `}
        >
          <ThumbsUp
            className={`w-4 h-4 ${userInteraction === 'like' ? 'fill-current' : ''}`}
          />
          <span>{likes}</span>
        </motion.button>

        {/* ---- Dislike Button ---- */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          animate={
            userInteraction === 'dislike' ? { scale: [1, 1.2, 1] } : {}
          }
          onClick={() => handleInteraction('dislike')}
          className={`
            flex items-center gap-2 px-5 py-2.5 rounded-2xl font-bold transition-all duration-300
            ${
              userInteraction === 'dislike'
                ? 'bg-red-600 text-white shadow-lg shadow-red-500/30 ring-2 ring-red-500/50'
                : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
            }
          `}
        >
          <ThumbsDown
            className={`w-4 h-4 ${userInteraction === 'dislike' ? 'fill-current' : ''}`}
          />
          <span>{dislikes}</span>
        </motion.button>
      </div>

      {/* Viewer count badge */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2.5 bg-white dark:bg-gray-800 px-5 py-2.5 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <Eye className="w-4 h-4 text-blue-500" />
          <div className="flex flex-col">
            <span className="text-sm font-black text-gray-900 dark:text-gray-100 leading-none">
              {viewerCount}
            </span>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">
              Watching Now
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StreamInteractions;