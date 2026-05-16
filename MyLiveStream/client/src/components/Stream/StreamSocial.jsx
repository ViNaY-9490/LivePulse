/**
 * -------------------------------------------------------
 * File: components/StreamSocial.jsx
 * Purpose:
 * Composes the full social interaction layer for a live
 * stream: interactions (like/dislike + viewer count),
 * floating reaction emojis, and the real‑time chat panel.
 *
 * This component is the top‑level layout wrapper that
 * arranges the three engagement subsystems into a
 * responsive two‑column grid. It is intended to be
 * rendered only when a stream is actively broadcasting.
 *
 * Layout Strategy:
 * - On large screens (`lg`), the interaction + reaction
 *   panel occupies the left 2/3, and the chat panel
 *   occupies the right 1/3.
 * - On smaller screens, both panels stack vertically
 *   with the chat given a fixed height for consistency.
 *
 * Design Decisions:
 * - Each child component (`StreamInteractions`,
 *   `LiveReactions`, `StreamChat`) is self‑contained
 *   and manages its own WebSocket subscriptions. This
 *   component is purely a layout container and does
 *   not pass the socket or manage any shared state.
 * - The reaction area is wrapped in a dashed‑border
 *   container with a fixed height to give it visual
 *   weight even before reactions appear, preventing
 *   layout shifts when the first reaction is sent.
 *
 * Dependencies:
 * - ./StreamInteractions: Like/dislike bar + viewer count
 * - ./LiveReactions: Floating emoji reaction system
 * - ./StreamChat: Real‑time chat with threading and likes
 * -------------------------------------------------------
 */

import React from 'react';
import StreamInteractions from './StreamInteractions';
import StreamChat from './StreamChat';
import LiveReactions from './LiveReactions';

/**
 * StreamSocial
 *
 * The composite social panel for an active live stream.
 * Arranges interactions, reactions, and chat into a
 * responsive grid layout.
 *
 * @param {object} props
 * @param {string} props.streamId - Unique identifier for the stream
 * @param {string} props.username - Display name of the current user
 */
const StreamSocial = ({ streamId, username }) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8 min-h-[600px]">
      {/* ---------------------------------------------------------------- */}
      {/* Left Column: Interaction Bar + Live Reactions                   */}
      {/* ---------------------------------------------------------------- */}
      <div className="lg:col-span-2 flex flex-col gap-6">
        {/* Frosted‑glass card wrapping the interactions and reactions */}
        <div className="bg-white/80 dark:bg-gray-900/50 backdrop-blur-md border border-gray-200 dark:border-gray-700 p-6 md:p-8 rounded-[2.5rem] shadow-xl flex flex-col transition-colors duration-300">
          {/* Section header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <h3 className="text-2xl font-black text-gray-900 dark:text-gray-100 tracking-tight">
                Stream Interaction
              </h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                Engage with the streamer and community in real‑time.
              </p>
            </div>
          </div>

          {/* Like / Dislike bar + viewer count */}
          <StreamInteractions streamId={streamId} username={username} />

          {/* Divider + reaction section */}
          <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] mb-4">
              Send a Reaction
            </h4>

            {/* The reaction area uses a fixed height (h‑64) and a dashed
                border to create a clear "drop zone" visual. This prevents
                the layout from shifting when the first reaction appears
                and gives users a clear target area. */}
            <div className="h-64 relative bg-gray-100 dark:bg-gray-950/50 rounded-3xl border border-dashed border-gray-300 dark:border-gray-800 overflow-hidden">
              <LiveReactions streamId={streamId} />
            </div>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Right Column: Live Chat Panel                                   */}
      {/* ---------------------------------------------------------------- */}
      <div className="lg:col-span-1 h-[600px] lg:h-auto">
        {/* Chat panel fills its container height. On mobile, a fixed
            height (h‑[600px]) prevents the chat from collapsing when
            the interaction panel above is tall. On large screens,
            `lg:h-auto` lets it stretch to match the left column. */}
        <StreamChat streamId={streamId} username={username} />
      </div>
    </div>
  );
};

export default StreamSocial;