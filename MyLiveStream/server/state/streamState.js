/**
 * -------------------------------------------------------
 * File: state/streamState.js
 * Purpose:
 * Manages the in‑memory store for active live stream
 * sessions. This module is the server‑side source of truth
 * for all stream metadata, WebSocket connections, chat
 * history, and interaction data.
 *
 * This module provides:
 * - `streamSessions`       — The global in‑memory store
 *                            (default export).
 * - `createStreamSession`  — Factory for a new session object
 *                            with sensible defaults.
 * - `ensureStreamSession`  — Gets or creates a session for a
 *                            given stream ID.
 * - `closeStreamSession`   — Gracefully tears down a session,
 *                            closing broadcaster and viewer
 *                            WebSockets and cleaning up memory.
 *
 * High‑Level Architecture:
 * 1. When a streamer starts broadcasting, `ensureStreamSession`
 *    creates (or reuses) a session object keyed by stream ID.
 * 2. The socket handler (`socketHandler.js`) reads and mutates
 *    this session throughout the stream's lifecycle.
 * 3. When the stream ends (or the streamer disconnects),
 *    `closeStreamSession` cleans up all associated WebSocket
 *    connections and deletes the session from memory.
 *
 * Design Decisions:
 * - **In‑memory store:** Suitable for single‑process deployments.
 *   For horizontal scaling (multiple Node.js instances), this
 *   must be replaced with a shared store (Redis) and the
 *   Socket.IO Redis adapter.
 * - **`Set` for viewers:** Uses a JavaScript `Set` to track
 *   viewer WebSocket connections. This prevents duplicate
 *   entries and provides O(1) lookup and deletion.
 * - **Factory pattern (`createStreamSession`):** Centralises
 *   the default shape of a session object. Adding a new
 *   property only requires updating the factory, not every
 *   place that creates a session.
 * - **`ensureStreamSession` idempotency:** Safe to call
 *   multiple times — creates if absent, merges overrides if
 *   present. This prevents accidental session replacement.
 *
 * Edge Cases Handled:
 * - **Session doesn't exist on close** → `closeStreamSession`
 *   is a no‑op (doesn't throw).
 * - **Viewer WebSocket already closed** → `readyState === 1`
 *   check prevents calling `.close()` on an already‑closed
 *   socket.
 * - **Streamer reconnects with same key** → `ensureStreamSession`
 *   merges the new `streamerId` into the existing session
 *   rather than creating a duplicate.
 *
 * Memory Management:
 * - `closeStreamSession` explicitly clears the viewer `Set`
 *   and deletes the session from the store. This allows the
 *   garbage collector to reclaim memory for ended streams.
 * - Without this, streams that end but are never cleaned up
 *   would leak memory indefinitely.
 *
 * Dependencies:
 * - None (pure data management; no external libraries)
 * -------------------------------------------------------
 */

// ----------------------------------------------------------------------
// Global In‑Memory Store
// ----------------------------------------------------------------------

/**
 * The global in‑memory store for all active stream sessions.
 *
 * Key: stream ID (string).
 * Value: Session object (created by `createStreamSession`).
 *
 * Why a plain object:
 * - Fast property‑based lookup by stream ID.
 * - No serialisation/deserialisation overhead.
 * - Suitable for a single Node.js process.
 *
 * Production scaling note:
 * For multi‑process deployments, this object should be
 * replaced with a Redis hash or similar shared key‑value
 * store to keep sessions synchronised across instances.
 */
const streamSessions = {};

// ----------------------------------------------------------------------
// Session Factory
// ----------------------------------------------------------------------

/**
 * Creates a new stream session object with sensible defaults.
 *
 * All fields are initialised to empty/neutral values so
 * consumers don't need to check for existence before reading.
 *
 * @param {object} [overrides={}] - Optional properties to
 *   merge into the defaults (e.g., `{ streamerId: 'abc123' }`).
 * @returns {object} A fresh session object.
 *
 * @example
 * const session = createStreamSession({ streamerId: socket.id });
 * // session.streamerId === socket.id
 * // session.comments === []
 * // session.interactions === { likes: 0, dislikes: 0, users: {} }
 */
export const createStreamSession = (overrides = {}) => ({
  /** Socket ID of the streamer (set when they start broadcasting) */
  streamerId: null,

  /** The broadcaster WebSocket connection (set by the media server) */
  broadcaster: null,

  /** Whether the stream is currently paused by the streamer */
  paused: false,

  /**
   * Set of viewer WebSocket connections.
   *
   * Using a `Set` ensures:
   * - No duplicate connections.
   * - O(1) add/delete/has operations.
   * - Easy iteration for broadcasting or closing all viewers.
   */
  viewers: new Set(),

  /**
   * Initial media segment for MSE playback.
   * Set by the media server when the first viewer connects.
   */
  initSegment: null,

  /**
   * Chat comments for this stream.
   *
   * Stored as an array in chronological order (oldest first).
   * Limited to `MAX_COMMENTS_PER_STREAM` by the socket handler.
   */
  comments: [],

  /**
   * Stream‑level interaction data (likes / dislikes).
   *
   * - `likes`: Total number of likes.
   * - `dislikes`: Total number of dislikes.
   * - `users`: Map of username → `'like'` | `'dislike'` for
   *   tracking each user's current interaction.
   */
  interactions: {
    likes: 0,
    dislikes: 0,
    users: {},
  },

  /**
   * Recent reactions array.
   * Currently unused in favour of ephemeral broadcast‑only
   * reactions, but retained for potential future features
   * (e.g., reaction history, analytics).
   */
  reactions: [],

  // Apply any caller‑provided overrides on top of defaults
  ...overrides,
});

// ----------------------------------------------------------------------
// Session Management Helpers
// ----------------------------------------------------------------------

/**
 * Retrieves an existing stream session or creates a new one.
 *
 * Why this exists:
 * Multiple places in the socket handler need to access a
 * session (stream start, viewer join, comment send, etc.).
 * This function centralises the "get or create" pattern,
 * ensuring consistency and preventing accidental session
 * replacement.
 *
 * Behaviour:
 * - If the session doesn't exist, it's created with the
 *   provided overrides merged into the defaults.
 * - If the session already exists, the overrides are merged
 *   into the existing session via `Object.assign`. This
 *   allows updating properties (e.g., `streamerId`) without
 *   losing existing data (e.g., `comments`).
 *
 * @param {string} streamId - The unique stream key
 * @param {object} [overrides={}] - Properties to set on the session
 * @returns {object} The existing or newly created session
 *
 * @example
 * // First call: creates the session
 * const session = ensureStreamSession('abc123', { streamerId: socket.id });
 *
 * // Later call: merges into existing session (doesn't overwrite comments)
 * const sameSession = ensureStreamSession('abc123', { paused: false });
 */
export const ensureStreamSession = (streamId, overrides = {}) => {
  if (!streamSessions[streamId]) {
    // Create a fresh session with the provided overrides
    streamSessions[streamId] = createStreamSession(overrides);
  } else {
    // Merge overrides into the existing session
    // (mutates in place — safe because we own the object)
    Object.assign(streamSessions[streamId], overrides);
  }

  return streamSessions[streamId];
};

// ----------------------------------------------------------------------
// Session Teardown
// ----------------------------------------------------------------------

/**
 * Gracefully shuts down a stream session and cleans up
 * all associated resources.
 *
 * Workflow:
 * 1. Closes the broadcaster WebSocket (if open).
 * 2. Closes all viewer WebSocket connections.
 * 3. Clears the viewer set.
 * 4. Deletes the session from the global store.
 *
 * Why close WebSockets explicitly:
 * If we only deleted the session object, the WebSocket
 * connections would remain open, consuming server resources
 * and potentially sending data to clients that no longer
 * have a valid session context.
 *
 * The `readyState === 1` (WebSocket.OPEN) check prevents
 * calling `.close()` on already‑closed or closing sockets,
 * which would throw an error.
 *
 * @param {string} streamId - The stream key to shut down
 * @param {object} [options]
 * @param {boolean} [options.closeBroadcaster=true] - Whether
 *   to close the broadcaster WebSocket. Set to `false` if
 *   the broadcaster is being migrated or the connection is
 *   already handled elsewhere.
 *
 * @example
 * // Full teardown (default)
 * closeStreamSession('abc123');
 *
 * // Close viewers but keep the broadcaster connection alive
 * closeStreamSession('abc123', { closeBroadcaster: false });
 */
export const closeStreamSession = (
  streamId,
  { closeBroadcaster = true } = {},
) => {
  const session = streamSessions[streamId];

  // Guard: if the session doesn't exist, there's nothing to clean up.
  if (!session) return;

  // Close the broadcaster WebSocket if it's still open.
  // `readyState === 1` means the WebSocket is in the OPEN state.
  if (closeBroadcaster && session.broadcaster?.readyState === 1) {
    session.broadcaster.close();
  }

  // Close all viewer WebSocket connections.
  // We iterate over the Set and close each one that's still open.
  session.viewers.forEach((viewer) => {
    if (viewer.readyState === 1) {
      viewer.close();
    }
  });

  // Clear the viewer set so the garbage collector can reclaim
  // the references.
  session.viewers.clear();

  // Remove the session from the global store.
  // After this, any further operations on this stream ID will
  // create a fresh session.
  delete streamSessions[streamId];
};

// ----------------------------------------------------------------------
// Default Export
// ----------------------------------------------------------------------

/**
 * The global stream sessions store.
 *
 * Imported by `socketHandler.js` to read and mutate session
 * state throughout the stream lifecycle.
 *
 * This is the default export for convenience, but named
 * exports (`createStreamSession`, `ensureStreamSession`,
 * `closeStreamSession`) are preferred for new code as they
 * are more explicit and tree‑shakeable.
 */
export default streamSessions;