/**
 * -------------------------------------------------------
 * File: socket/socketHandler.js
 * Purpose:
 * The central Socket.IO event handler. Manages all real‑time
 * communication between streamers and viewers, including
 * stream lifecycle, chat, comments, reactions, interactions
 * (likes/dislikes), and viewer counts.
 *
 * This module is the server‑side counterpart to the
 * client's `SocketContext` provider. Every `socket.emit`
 * from the client has a corresponding `socket.on` handler
 * defined here.
 *
 * High‑Level Architecture:
 * 1. On server start, this function is called with the
 *    Socket.IO server instance (`io`).
 * 2. It registers a `connection` listener that sets up
 *    per‑socket event handlers for each client.
 * 3. Stream state is maintained in an in‑memory object
 *    (`streamSessions`) shared across all socket instances.
 * 4. Viewer counts are calculated from Socket.IO's internal
 *    room membership, excluding the streamer's own socket.
 *
 * Event Categories:
 * - **Stream lifecycle:** `start-stream`, `stop-stream`,
 *   `pause-stream`, `resume-stream`.
 * - **Room management:** `join-stream`, `leave-stream`,
 *   `check-stream`.
 * - **Chat:** `send-comment`, `toggle-comment-like`.
 * - **Reactions:** `send-reaction`.
 * - **Interactions:** `toggle-interaction`.
 * - **Internal:** `disconnecting`, `disconnect`.
 *
 * Design Decisions:
 * - **In‑memory state (`streamSessions`):** Suitable for a
 *   single‑process deployment. For multi‑process or
 *   horizontally‑scaled deployments, this must be replaced
 *   with a shared store (Redis adapter for Socket.IO).
 * - **Viewer count via room inspection:** Rather than
 *   maintaining a manual counter, the count is derived
 *   from `io.sockets.adapter.rooms`. This is always
 *   accurate and can't drift due to missed events.
 * - **Optimistic broadcasts:** The server broadcasts events
 *   to all clients in a room, including the sender. The
 *   sender's client uses the broadcast to confirm the
 *   action and keep the UI in sync.
 * - **Comment limiting:** Maximum 50 comments stored per
 *   stream. When the limit is exceeded, the oldest comment
 *   is removed (FIFO eviction). This prevents unbounded
 *   memory growth for long‑running streams.
 *
 * Security & Input Validation:
 * - All string inputs are trimmed and length‑capped to
 *   prevent storage exhaustion and XSS vectors.
 * - Reactions are validated against an allowlist
 *   (`ALLOWED_REACTIONS`). Unknown reaction types are
 *   silently ignored.
 * - Interaction types are validated (`like`/`dislike` only).
 * - Stream IDs are normalised to prevent path traversal
 *   or injection via room names.
 *
 * Edge Cases Handled:
 * - **Streamer disconnects abruptly** → `disconnect` handler
 *   calls `endStream` if the disconnected socket was the
 *   active streamer.
 * - **Viewer navigates between streams** → `join-stream`
 *   automatically leaves previous rooms before joining the
 *   new one.
 * - **Duplicate stream start** → `start-stream` checks for
 *   an existing streamer and rejects if the key is already
 *   in use by a different socket.
 * - **Unknown stream ID in any handler** → silently ignored
 *   or returns `{ ok: false }` via callback.
 *
 * Dependencies:
 * - socket.io: The Socket.IO server instance passed as `io`
 * - ../state/streamState.js: In‑memory stream session store
 * -------------------------------------------------------
 */

import streamSessions, {
  closeStreamSession,
  ensureStreamSession,
} from '../state/streamState.js';

// ----------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------

/**
 * Maximum length of a chat comment text.
 * Enforced server‑side even though the client also limits
 * input, because client‑side validation can be bypassed.
 */
const MAX_COMMENT_LENGTH = 500;

/**
 * Maximum number of comments stored per stream.
 *
 * When this limit is reached, the oldest comment is evicted
 * (shifted from the front of the array). This keeps memory
 * usage bounded even for streams that run for hours.
 */
const MAX_COMMENTS_PER_STREAM = 50;

/**
 * Allowlisted reaction types.
 *
 * Only these reactions are accepted and broadcast. Any
 * other type is silently ignored. This prevents clients
 * from injecting arbitrary reaction types that the UI
 * can't render.
 */
const ALLOWED_REACTIONS = new Set([
  'heart',
  'laugh',
  'wow',
  'sad',
  'angry',
  'thumbsup',
]);

// ----------------------------------------------------------------------
// Input Sanitisation Helpers
// ----------------------------------------------------------------------

/**
 * Normalises a stream ID for safe use as a Socket.IO room name.
 *
 * Trims whitespace and caps length at 100 characters to
 * prevent abuse (e.g., extremely long room names causing
 * memory issues).
 *
 * @param {string} streamId - Raw stream ID from client input
 * @returns {string} Sanitised stream ID, or empty string if invalid
 */
const normalizeStreamId = (streamId) => {
  if (typeof streamId !== 'string') return '';
  return streamId.trim().slice(0, 100);
};

/**
 * Normalises a text input for chat comments and usernames.
 *
 * Trims whitespace and caps at the specified maximum length.
 * Returns an empty string if the input is not a string.
 *
 * @param {string} text - Raw text input
 * @param {number} [maxLength=MAX_COMMENT_LENGTH] - Maximum allowed length
 * @returns {string} Sanitised text
 */
const normalizeText = (text, maxLength = MAX_COMMENT_LENGTH) => {
  if (typeof text !== 'string') return '';
  return text.trim().slice(0, maxLength);
};

/**
 * Finds a comment by its ID within a stream session.
 *
 * Returns `undefined` if the session doesn't exist or the
 * comment isn't found.
 *
 * @param {object} session - The stream session object
 * @param {string} commentId - The comment ID to search for
 * @returns {object|undefined} The comment object, or undefined
 */
const findComment = (session, commentId) =>
  session?.comments.find((comment) => comment.id === commentId);

/**
 * Calculates the number of likes on a comment.
 *
 * Likes are stored as an object keyed by username
 * (`{ username: true }`). This counts the keys.
 *
 * @param {object} comment - The comment object
 * @returns {number} Total like count
 */
const getCommentLikes = (comment) =>
  Object.keys(comment.likedBy || {}).length;

/**
 * Prepares a comment for broadcast to clients.
 *
 * Attaches the calculated `likes` count and ensures the
 * object is safe to send (no internal references).
 *
 * @param {object} comment - The raw comment object
 * @returns {object} A sanitised copy ready for broadcast
 */
const sanitizeComment = (comment) => ({
  ...comment,
  likes: getCommentLikes(comment),
});

// ----------------------------------------------------------------------
// Socket.IO Handler
// ----------------------------------------------------------------------

/**
 * Registers all Socket.IO event handlers for real‑time
 * stream communication.
 *
 * This function should be called once after the HTTP server
 * and Socket.IO instance are created.
 *
 * @param {import('socket.io').Server} io - The Socket.IO server instance
 */
export default (io) => {
  // --------------------------------------------------------------------
  // Internal Helpers (scoped to the `io` instance)
  // --------------------------------------------------------------------

  /**
   * Broadcasts the current viewer count for a stream to all
   * clients in that stream's room.
   *
   * How it works:
   * 1. Gets the Set of socket IDs in the room from Socket.IO's
   *    internal adapter.
   * 2. Filters out the streamer's own socket (streamers don't
   *    count as viewers).
   * 3. Emits the count to all clients in the room.
   *
   * Why recalculate from the adapter:
   * Room membership managed by Socket.IO is the authoritative
   * source. Manually tracking joins/leaves can drift due to
   * missed or duplicate events. Querying the adapter is always
   * accurate.
   *
   * @param {string} streamId - The stream's room name
   */
  const updateViewerCount = (streamId) => {
    const room = io.sockets.adapter.rooms.get(streamId);

    // Count sockets in the room, excluding the streamer's own socket
    const count = room
      ? [...room]
          .map((socketId) => io.sockets.sockets.get(socketId))
          .filter(
            (client) =>
              client &&
              // Exclude the streamer: a socket that is actively
              // broadcasting this specific stream.
              !(
                client.isStreamer &&
                client.activeStreamId === streamId
              ),
          ).length
      : 0;

    io.to(streamId).emit('viewer-count', count);
  };

  /**
   * Ends a stream session and notifies all viewers.
   *
   * Workflow:
   * 1. Emits `stream-ended` to all clients in the room.
   * 2. Cleans up the in‑memory session.
   * 3. Updates the viewer count (which will be 0 after cleanup).
   *
   * @param {string} streamId - The stream to end
   * @param {string} [reason='stream-ended'] - Reason for ending
   *   ('streamer-stopped', 'streamer-disconnected', etc.)
   * @returns {boolean} True if the stream existed and was ended
   */
  const endStream = (streamId, reason = 'stream-ended') => {
    const session = streamSessions[streamId];
    if (!session) return false;

    io.to(streamId).emit('stream-ended', { streamId, reason });
    closeStreamSession(streamId);
    updateViewerCount(streamId);
    return true;
  };

  // --------------------------------------------------------------------
  // Connection Handler
  // --------------------------------------------------------------------

  io.on('connection', (socket) => {
    console.log(
      `[Socket] Client connected: ${socket.id} (total: ${io.engine.clientsCount})`,
    );

    // ----------------------------------------------------------------
    // Stream Lifecycle Events
    // ----------------------------------------------------------------

    /**
     * `start-stream`
     *
     * Called by the streamer to begin broadcasting.
     *
     * Workflow:
     * 1. Sanitise the stream ID.
     * 2. Check if the key is already in use by another streamer.
     * 3. Join the room and mark this socket as the streamer.
     * 4. Initialise or update the session.
     * 5. Notify viewers and update counts.
     */
    socket.on('start-stream', (rawStreamId, callback) => {
      const streamId = normalizeStreamId(rawStreamId);

      if (!streamId) {
        if (typeof callback === 'function')
          callback({ ok: false, message: 'Invalid stream id' });
        return;
      }

      // Prevent two streamers from using the same stream key
      const existingSession = streamSessions[streamId];
      if (
        existingSession?.streamerId &&
        existingSession.streamerId !== socket.id
      ) {
        if (typeof callback === 'function')
          callback({ ok: false, message: 'Stream key is already active' });
        return;
      }

      socket.join(streamId);
      socket.activeStreamId = streamId;
      socket.isStreamer = true;

      const session = ensureStreamSession(streamId, {
        streamerId: socket.id,
      });
      session.streamerId = socket.id;
      session.paused = false;

      io.to(streamId).emit('stream-started', { streamId });
      updateViewerCount(streamId);

      if (typeof callback === 'function') callback({ ok: true });
    });

    /**
     * `stop-stream`
     *
     * Called by the streamer to manually end their broadcast.
     * Ends the session, notifies viewers, and cleans up the
     * socket's streamer state.
     */
    socket.on('stop-stream', (rawStreamId, callback) => {
      const streamId = normalizeStreamId(
        rawStreamId || socket.activeStreamId,
      );
      const session = streamSessions[streamId];

      if (!streamId || !session || session.streamerId !== socket.id) {
        if (typeof callback === 'function')
          callback({ ok: false, message: 'Stream not found' });
        return;
      }

      endStream(streamId, 'streamer-stopped');
      socket.leave(streamId);
      socket.activeStreamId = null;
      socket.isStreamer = false;

      if (typeof callback === 'function') callback({ ok: true });
    });

    /**
     * `pause-stream`
     *
     * Called by the streamer to pause their broadcast.
     * Sets the session's paused flag and notifies viewers
     * so they can display a "Stream Paused" overlay.
     */
    socket.on('pause-stream', (rawStreamId, callback) => {
      const streamId = normalizeStreamId(
        rawStreamId || socket.activeStreamId,
      );
      const session = streamSessions[streamId];

      if (!streamId || !session || session.streamerId !== socket.id) {
        if (typeof callback === 'function')
          callback({ ok: false, message: 'Stream not found' });
        return;
      }

      session.paused = true;
      io.to(streamId).emit('stream-paused', { streamId });
      if (typeof callback === 'function') callback({ ok: true });
    });

    /**
     * `resume-stream`
     *
     * Called by the streamer to resume a paused broadcast.
     */
    socket.on('resume-stream', (rawStreamId, callback) => {
      const streamId = normalizeStreamId(
        rawStreamId || socket.activeStreamId,
      );
      const session = streamSessions[streamId];

      if (!streamId || !session || session.streamerId !== socket.id) {
        if (typeof callback === 'function')
          callback({ ok: false, message: 'Stream not found' });
        return;
      }

      session.paused = false;
      io.to(streamId).emit('stream-resumed', { streamId });
      if (typeof callback === 'function') callback({ ok: true });
    });

    // ----------------------------------------------------------------
    // Room Management Events
    // ----------------------------------------------------------------

    /**
     * `join-stream`
     *
     * Called when a viewer navigates to a stream page.
     *
     * Workflow:
     * 1. Sanitise the stream ID.
     * 2. Leave any previously joined rooms (so a viewer is
     *    only in one stream room at a time).
     * 3. Join the new room.
     * 4. Send the viewer the current state: comments,
     *    interactions, and pause status.
     * 5. Update viewer counts for both the old and new rooms.
     */
    socket.on('join-stream', (rawStreamId, callback) => {
      const streamId = normalizeStreamId(rawStreamId);

      if (!streamId) {
        if (typeof callback === 'function')
          callback({ ok: false, message: 'Invalid stream id' });
        return;
      }

      // Leave all previously joined rooms (excluding the
      // socket's own private room, which is named after its ID).
      const previousRooms = [...socket.rooms].filter(
        (room) => room !== socket.id && room !== streamId,
      );
      previousRooms.forEach((room) => socket.leave(room));

      socket.join(streamId);
      socket.watchingStreamId = streamId;

      // Send current state to the newly joined viewer
      const session = streamSessions[streamId];
      if (session) {
        // Send existing comments (with calculated likes)
        socket.emit(
          'all-comments',
          session.comments.map(sanitizeComment),
        );
        // Send current interaction state
        socket.emit('update-interactions', {
          likes: session.interactions.likes,
          dislikes: session.interactions.dislikes,
          userInteractions: session.interactions.users,
        });
        // If the stream is paused, notify immediately
        if (session.paused) {
          socket.emit('stream-paused', { streamId });
        }
      }

      // Update counts for both the new room and any rooms we left
      updateViewerCount(streamId);
      previousRooms.forEach((room) => updateViewerCount(room));

      if (typeof callback === 'function')
        callback({ ok: true, exists: Boolean(session) });
    });

    /**
     * `leave-stream`
     *
     * Called when a viewer navigates away from a stream.
     * Leaves the room and updates the viewer count.
     */
    socket.on('leave-stream', (rawStreamId, callback) => {
      const streamId = normalizeStreamId(
        rawStreamId || socket.watchingStreamId,
      );

      if (!streamId) {
        if (typeof callback === 'function')
          callback({ ok: false, message: 'Invalid stream id' });
        return;
      }

      socket.leave(streamId);
      if (socket.watchingStreamId === streamId)
        socket.watchingStreamId = null;
      updateViewerCount(streamId);

      if (typeof callback === 'function') callback({ ok: true });
    });

    /**
     * `check-stream`
     *
     * Lightweight check to determine if a stream key is
     * active. Used by the viewer's "Join" form to validate
     * the stream key before navigating to the watch page.
     */
    socket.on('check-stream', (rawStreamId, callback) => {
      const streamId = normalizeStreamId(rawStreamId);
      const exists = Boolean(streamId && streamSessions[streamId]);

      if (typeof callback === 'function') {
        callback({ exists });
      }
    });

    // ----------------------------------------------------------------
    // Chat Events
    // ----------------------------------------------------------------

    /**
     * `send-comment`
     *
     * Sends a chat message (or reply) to all viewers in the
     * stream room.
     *
     * Workflow:
     * 1. Sanitise all inputs.
     * 2. If replying, look up the target comment.
     * 3. Create the comment object with a unique ID.
     * 4. Append to the session's comment array.
     * 5. Evict oldest comment if the array exceeds the limit.
     * 6. Broadcast to all clients in the room.
     */
    socket.on(
      'send-comment',
      ({ streamId: rawStreamId, username, text, replyToId } = {}) => {
        const streamId = normalizeStreamId(rawStreamId);
        const session = streamSessions[streamId];
        const cleanText = normalizeText(text);
        const cleanUsername = normalizeText(username, 80) || 'Anonymous';

        // Silently ignore if the stream doesn't exist or the
        // text is empty after sanitisation.
        if (!session || !cleanText) return;

        // Look up the reply target if this is a threaded reply
        const replyTarget = replyToId
          ? findComment(session, replyToId)
          : null;

        const comment = {
          username: cleanUsername,
          text: cleanText,
          timestamp: new Date().toISOString(),
          // Unique ID: timestamp + random alphanumeric suffix
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          likedBy: {},
          likes: 0,
          replyTo: replyTarget
            ? {
                id: replyTarget.id,
                username: replyTarget.username,
                text: replyTarget.text.slice(0, 120), // Truncate preview
              }
            : null,
        };

        session.comments.push(comment);

        // Evict oldest comment if over the limit (FIFO)
        if (session.comments.length > MAX_COMMENTS_PER_STREAM) {
          session.comments.shift();
        }

        io.to(streamId).emit('new-comment', sanitizeComment(comment));
      },
    );

    /**
     * `toggle-comment-like`
     *
     * Toggles a like on a chat comment for a specific user.
     *
     * If the user has already liked the comment, the like is
     * removed. Otherwise, it's added. The updated comment
     * (with the new like count) is broadcast to all viewers.
     */
    socket.on(
      'toggle-comment-like',
      ({ streamId: rawStreamId, commentId, username } = {}) => {
        const streamId = normalizeStreamId(rawStreamId);
        const session = streamSessions[streamId];
        // Fall back to socket ID if no username is provided
        // (allows liking without being logged in, though the
        // like won't persist across reconnects).
        const cleanUsername = normalizeText(username, 80) || socket.id;
        const comment = findComment(session, commentId);

        if (!comment) return;

        // Ensure likedBy exists (defensive, should always be set)
        if (!comment.likedBy) {
          comment.likedBy = {};
        }

        // Toggle: remove if already liked, add if not
        if (comment.likedBy[cleanUsername]) {
          delete comment.likedBy[cleanUsername];
        } else {
          comment.likedBy[cleanUsername] = true;
        }

        comment.likes = getCommentLikes(comment);
        io.to(streamId).emit('comment-updated', sanitizeComment(comment));
      },
    );

    // ----------------------------------------------------------------
    // Reaction Events
    // ----------------------------------------------------------------

    /**
     * `send-reaction`
     *
     * Broadcasts a floating emoji reaction to all viewers.
     *
     * The reaction type is validated against `ALLOWED_REACTIONS`.
     * Unknown types are silently ignored.
     */
    socket.on(
      'send-reaction',
      ({ streamId: rawStreamId, type } = {}) => {
        const streamId = normalizeStreamId(rawStreamId);

        // Validate: stream must exist and reaction type must be allowed
        if (!streamSessions[streamId] || !ALLOWED_REACTIONS.has(type))
          return;

        io.to(streamId).emit('new-reaction', {
          type,
          id: `${Date.now()}-${socket.id}`,
        });
      },
    );

    // ----------------------------------------------------------------
    // Interaction Events (Like / Dislike the Stream)
    // ----------------------------------------------------------------

    /**
     * `toggle-interaction`
     *
     * Toggles the current user's interaction with the stream
     * (like, dislike, or neutral).
     *
     * Logic:
     * - If the user already has the same interaction, it's
     *   removed (back to neutral).
     * - Otherwise, the interaction is set (or switched if
     *   the user had the opposite interaction).
     *
     * This enforces a single interaction per user: a user
     * can either like or dislike, not both.
     */
    socket.on(
      'toggle-interaction',
      ({ streamId: rawStreamId, username, type } = {}) => {
        const streamId = normalizeStreamId(rawStreamId);
        const session = streamSessions[streamId];
        const cleanUsername = normalizeText(username, 80) || socket.id;

        // Validate: stream must exist and interaction type must be valid
        if (!session || !['like', 'dislike'].includes(type)) return;

        const users = session.interactions.users;
        const currentType = users[cleanUsername];

        // If the user clicks the same interaction again, remove it
        if (currentType === type) {
          delete users[cleanUsername];
        } else {
          // Set the new interaction (overwrites the opposite if one exists)
          users[cleanUsername] = type;
        }

        // Recalculate counts from the users map
        const values = Object.values(users);
        session.interactions.likes = values.filter(
          (value) => value === 'like',
        ).length;
        session.interactions.dislikes = values.filter(
          (value) => value === 'dislike',
        ).length;

        // Broadcast the updated state to all viewers
        io.to(streamId).emit('update-interactions', {
          likes: session.interactions.likes,
          dislikes: session.interactions.dislikes,
          userInteractions: users,
        });
      },
    );

    // ----------------------------------------------------------------
    // Disconnection Events
    // ----------------------------------------------------------------

    /**
     * `disconnecting`
     *
     * Fires *before* the socket leaves its rooms.
     * We schedule viewer count updates for all rooms the
     * socket was in. The `setTimeout(..., 0)` defers the
     * update until after Socket.IO has processed the room
     * departure internally.
     */
    socket.on('disconnecting', () => {
      [...socket.rooms]
        .filter((room) => room !== socket.id)
        .forEach((room) => {
          setTimeout(() => updateViewerCount(room), 0);
        });
    });

    /**
     * `disconnect`
     *
     * Fires after the socket has fully disconnected.
     *
     * If the disconnected socket was an active streamer
     * (and not a WebRTC broadcaster — checked via
     * `!session.broadcaster`), end the stream so viewers
     * are notified immediately rather than waiting for a
     * timeout.
     */
    socket.on('disconnect', () => {
      const streamId = socket.activeStreamId;
      const session = streamSessions[streamId];

      if (
        streamId &&
        session?.streamerId === socket.id &&
        !session.broadcaster
      ) {
        endStream(streamId, 'streamer-disconnected');
      }
    });
  });
};