/**
 * -------------------------------------------------------
 * File: components/LiveReactions.jsx
 * Purpose:
 * Renders a real‑time reaction system for live streams.
 * Viewers can send emoji‑style reactions (heart, laugh,
 * wow, etc.) that float upward on all connected clients
 * via WebSockets.
 *
 * High‑Level Architecture:
 * 1. Joins a WebSocket room scoped to the current stream.
 * 2. Listens for incoming `new-reaction` events from the
 *    server and spawns floating reaction animations.
 * 3. Provides a row of reaction buttons that emit
 *    `send-reaction` events back to the server.
 * 4. Uses Framer Motion's `AnimatePresence` to cleanly
 *    remove animations from the DOM once they finish.
 *
 * Performance Considerations:
 * - Floating reactions are absolutely positioned and
 *   `pointer-events-none` so they never block interaction
 *   with the video player or controls beneath.
 * - Reactions are removed from state as soon as their
 *   animation completes, preventing memory leaks from
 *   an infinitely growing array.
 * - Each reaction is assigned a random trajectory to
 *   avoid visual uniformity.
 *
 * Dependencies:
 * - ../../SocketContext: Provides a connected Socket.IO client
 * - framer-motion: For floating animations and button micro‑interactions
 * - lucide-react: For reaction icons
 * -------------------------------------------------------
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSocket } from '../../SocketContext';
import { Heart, Laugh, Sparkles, Frown, Angry, ThumbsUp } from 'lucide-react';

// ----------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------

/**
 * Supported reaction types with their associated icon component
 * and Tailwind colour class.
 *
 * The colour is applied to both the button and the floating icon,
 * keeping the visual language consistent.
 */
const REACTIONS = [
  { type: 'heart', icon: Heart, color: 'text-red-500' },
  { type: 'laugh', icon: Laugh, color: 'text-yellow-500' },
  { type: 'wow', icon: Sparkles, color: 'text-blue-500' },
  { type: 'sad', icon: Frown, color: 'text-indigo-500' },
  { type: 'angry', icon: Angry, color: 'text-orange-500' },
  { type: 'thumbsup', icon: ThumbsUp, color: 'text-green-500' },
];

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

/**
 * Retrieves the reaction configuration object for a given type.
 * Falls back to the first reaction (heart) if the type is unknown,
 * which guards against server‑sent reaction types that don't exist
 * in the client yet (e.g., during a phased rollout).
 *
 * @param {string} type - The reaction type string (e.g., 'heart')
 * @returns {{ type: string, icon: React.Component, color: string }}
 */
const getReaction = (type) =>
  REACTIONS.find((reaction) => reaction.type === type) || REACTIONS[0];

// ----------------------------------------------------------------------
// Sub‑components
// ----------------------------------------------------------------------

/**
 * FloatingReaction
 *
 * Renders a single animated reaction icon that floats upward
 * from a random horizontal position, fades out, and scales up
 * before calling `onComplete` to signal cleanup.
 *
 * Why this is a separate component:
 * - Isolates the animation logic from the main component.
 * - `AnimatePresence` requires direct children to have unique
 *   `key` props and animation lifecycle hooks.
 *
 * @param {object} props
 * @param {object} props.reaction - The reaction data (type, id, trajectory)
 * @param {function} props.onComplete - Callback invoked when the animation finishes
 */
const FloatingReaction = ({ reaction, onComplete }) => {
  const { icon: Icon, color } = getReaction(reaction.type);

  return (
    <motion.div
      // Start near the bottom at a small scale, then float up,
      // fade out, and grow slightly for a "pop" effect.
      initial={{ y: 0, opacity: 1, x: reaction.startX, scale: 0.5 }}
      animate={{ y: -400, opacity: 0, x: reaction.endX, scale: 1.5 }}
      // 3‑second duration with an ease‑out curve feels natural
      // and gives viewers time to see the reaction before it fades.
      transition={{ duration: 3, ease: 'easeOut' }}
      onAnimationComplete={onComplete}
      // Positioned absolutely at the bottom of the container.
      // `pointer-events-none` ensures floating icons never intercept
      // clicks meant for the video player or reaction buttons.
      className={`absolute bottom-0 pointer-events-none ${color}`}
      style={{ left: `${reaction.left}%` }}
    >
      {/* `fill="currentColor"` inherits the `color` class, keeping
          the icon's fill consistent with the text colour. */}
      <Icon fill="currentColor" />
    </motion.div>
  );
};

// ----------------------------------------------------------------------
// Main Component
// ----------------------------------------------------------------------

/**
 * LiveReactions Component
 *
 * Connects to a WebSocket room for the given stream and manages
 * the real‑time reaction display and sending interface.
 *
 * @param {object} props
 * @param {string} props.streamId - Unique identifier for the live stream
 */
const LiveReactions = ({ streamId }) => {
  const socket = useSocket();
  const [activeReactions, setActiveReactions] = useState([]);

  // --------------------------------------------------------------------
  // WebSocket Lifecycle
  // --------------------------------------------------------------------
  useEffect(() => {
    /**
     * Handles incoming reaction events from the server.
     *
     * Adds a unique ID and randomised trajectory data so each
     * floating reaction has its own starting position and path.
     *
     * Why randomise?
     * If all reactions followed the same path, they would overlap
     * and look like a single icon. Randomised trajectories create
     * the organic "confetti" feel expected in live reaction systems.
     */
    const handleNewReaction = (reaction) => {
      setActiveReactions((prev) => [
        ...prev,
        {
          ...reaction,
          // Fallback ID generation: the server should provide an `id`,
          // but if it doesn't, we create one to ensure `key` uniqueness.
          id: reaction.id || `${Date.now()}-${Math.random()}`,
          // Random horizontal starting position between 10% and 90%
          // so reactions don't clip off‑screen edges.
          left: Math.floor(Math.random() * 80) + 10,
          // Random X‑axis drift: startX and endX create a curved path
          // so reactions don't rise in a perfectly straight line.
          startX: Math.random() * 40 - 20,
          endX: Math.random() * 100 - 50,
        },
      ]);
    };

    // Join the stream‑specific WebSocket room so we only receive
    // reactions for the stream the user is currently watching.
    socket.emit('join-stream', streamId);
    socket.on('new-reaction', handleNewReaction);

    // Cleanup: leave the room and remove the listener when the
    // component unmounts or the streamId changes.
    return () => {
      socket.off('new-reaction', handleNewReaction);
      // Note: The server should handle room cleanup when the socket
      // disconnects, but we could also emit 'leave-stream' here for
      // immediate unsubscription if the server supports it.
    };
  }, [streamId, socket]);

  // --------------------------------------------------------------------
  // Outgoing Reaction Emitter
  // --------------------------------------------------------------------

  /**
   * Sends a reaction of the given type to the server.
   * The server is responsible for broadcasting it to all
   * other clients in the same stream room (including the
   * sender, so the floating animation appears for everyone).
   *
   * @param {string} type - One of the reaction type strings
   */
  const sendReaction = (type) => {
    socket.emit('send-reaction', { streamId, type });
  };

  // --------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------
  return (
    // The outer container fills its parent and uses flexbox to
    // pin the reaction buttons to the bottom centre.
    <div className="relative h-full w-full flex flex-col justify-end p-4">
      {/* Floating reaction layer: covers the entire container but
          ignores pointer events so the video and buttons remain
          fully interactive. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* AnimatePresence orchestrates exit animations for removed
            elements. Without it, reactions would disappear abruptly
            when removed from the array. */}
        <AnimatePresence>
          {activeReactions.map((reaction) => (
            <FloatingReaction
              key={reaction.id}
              reaction={reaction}
              // Remove the reaction from state once its animation
              // finishes, keeping the array small and memory‑safe.
              onComplete={() =>
                setActiveReactions((prev) =>
                  prev.filter((item) => item.id !== reaction.id),
                )
              }
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Reaction buttons bar: a frosted glass strip at the bottom
          centre of the stream. Buttons scale up on hover and emit
          the corresponding reaction type on click. */}
      <div className="flex gap-2 bg-gray-900/40 backdrop-blur-md p-2 rounded-2xl border border-gray-700/50 self-center">
        {REACTIONS.map(({ type, icon: Icon, color }) => (
          <motion.button
            key={type}
            // Lift and enlarge on hover for a playful, inviting feel.
            whileHover={{ scale: 1.2, y: -5 }}
            // Shrink on tap for responsive feedback.
            whileTap={{ scale: 0.9 }}
            onClick={() => sendReaction(type)}
            // A translucent hover background highlights the button
            // without overwhelming the icon colour.
            className={`p-2 rounded-xl hover:bg-white/10 transition-colors ${color}`}
          >
            <Icon className="w-6 h-6" />
          </motion.button>
        ))}
      </div>
    </div>
  );
};

export default LiveReactions;