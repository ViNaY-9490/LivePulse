/**
 * -------------------------------------------------------
 * File: components/StreamChat.jsx
 * Purpose:
 * Implements a real‑time, live‑stream chat panel with
 * support for threaded replies, comment liking, and
 * animated message appearance.
 *
 * This component is the primary social interaction layer
 * overlaid on a live stream. It connects to a WebSocket
 * server to send and receive messages in real time, with
 * no polling or page refreshes required.
 *
 * High‑Level Architecture:
 * 1. Joins a WebSocket room scoped to the current stream.
 * 2. Loads existing chat history (`all-comments` event).
 * 3. Listens for new messages and like updates in real time.
 * 4. Renders a scrollable message list with auto‑scroll to
 *    the latest message.
 * 5. Provides a text input with optional reply threading.
 *
 * Performance Decisions:
 * - `ChatMessage` is wrapped in `React.memo` to prevent
 *   unnecessary re‑renders when unrelated messages change.
 * - `useCallback` is used for event handlers passed as props
 *   to maintain referential stability.
 * - The message list uses `AnimatePresence` for smooth
 *   entrance/exit animations without layout thrashing.
 *
 * Edge Cases Handled:
 * - Empty chat state shows a friendly placeholder.
 * - Missing socket or streamId results in a clean no‑op.
 * - Replying to a message and then changing your mind clears
 *   the reply target.
 * - Comment IDs may be missing from the server; a fallback
 *   key is generated to prevent React key warnings.
 *
 * Dependencies:
 * - ../../SocketContext: Provides the Socket.IO client instance
 * - framer-motion: For message entrance animations
 * - lucide-react: For iconography throughout the chat UI
 * -------------------------------------------------------
 */

import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useSocket } from '../../SocketContext';
import { Send, MessageCircle, User, Heart, Reply, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ----------------------------------------------------------------------
// ChatMessage Sub‑component
// ----------------------------------------------------------------------

/**
 * ChatMessage
 *
 * Renders a single chat message bubble with optional reply
 * preview, like button, and reply button.
 *
 * Wrapped in `React.memo` to skip re‑rendering when sibling
 * messages change. It only re‑renders when its own `comment`,
 * `isMe`, `hasLiked`, or callbacks change.
 *
 * @param {object} props
 * @param {object} props.comment - The message object
 * @param {boolean} props.isMe - Whether this message was sent by the current user
 * @param {boolean} props.hasLiked - Whether the current user has liked this message
 * @param {function} props.onLike - Callback to like/unlike the message
 * @param {function} props.onReply - Callback to set this message as the reply target
 */
const ChatMessage = memo(({ comment, isMe, hasLiked, onLike, onReply }) => (
  <motion.div
    // Messages slide in from the side of the sender:
    // own messages from the right, others from the left.
    // This creates an intuitive spatial flow in the chat.
    initial={{ opacity: 0, x: isMe ? 20 : -20 }}
    animate={{ opacity: 1, x: 0 }}
    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
  >
    {/* Show the sender's username above messages from others.
        Own messages don't need a label – the colour and alignment
        already convey ownership. */}
    {!isMe && (
      <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 ml-1 px-1 flex items-center gap-1">
        <User className="w-2 h-2" />
        {comment.username}
      </span>
    )}

    <div className={`max-w-[85%] ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
      {/* Message bubble */}
      <div
        className={`
          w-full px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm
          ${
            isMe
              ? 'bg-blue-600 text-white rounded-tr-none'
              : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-tl-none border border-gray-200 dark:border-gray-700'
          }
          transition-all hover:scale-[1.01]
        `}
      >
        {/* Render the replied‑to message preview if this is a reply */}
        {comment.replyTo && (
          <div
            className={`mb-2 rounded-xl px-3 py-2 border-l-2 text-xs ${
              isMe
                ? 'bg-white/10 border-white/50 text-blue-50'
                : 'bg-gray-100 dark:bg-gray-900 border-blue-500 text-gray-500 dark:text-gray-400'
            }`}
          >
            <span className="block font-black uppercase tracking-wider text-[9px] mb-1">
              {comment.replyTo.username}
            </span>
            <span className="line-clamp-2">{comment.replyTo.text}</span>
          </div>
        )}

        {/* Main message text */}
        {comment.text}
      </div>

      {/* Action buttons: Like & Reply */}
      <div
        className={`mt-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider ${
          isMe ? 'justify-end' : 'justify-start'
        }`}
      >
        {/* Like button: shows filled heart and red colour when liked */}
        <button
          type="button"
          onClick={() => onLike(comment)}
          className={`flex items-center gap-1 px-2 py-1 rounded-full transition-colors ${
            hasLiked
              ? 'text-red-500 bg-red-500/10'
              : 'text-gray-400 hover:text-red-500 hover:bg-red-500/10'
          }`}
        >
          <Heart className={`w-3 h-3 ${hasLiked ? 'fill-current' : ''}`} />
          {comment.likes || 0}
        </button>

        {/* Reply button */}
        <button
          type="button"
          onClick={() => onReply(comment)}
          className="flex items-center gap-1 px-2 py-1 rounded-full text-gray-400 hover:text-blue-500 hover:bg-blue-500/10 transition-colors"
        >
          <Reply className="w-3 h-3" />
          Reply
        </button>
      </div>
    </div>
  </motion.div>
));

// ----------------------------------------------------------------------
// StreamChat Main Component
// ----------------------------------------------------------------------

/**
 * StreamChat
 *
 * The top‑level live‑chat panel. Manages WebSocket communication,
 * message state, auto‑scrolling, and the reply input workflow.
 *
 * @param {object} props
 * @param {string} props.streamId - Unique identifier for the stream
 * @param {string} props.username - Display name of the current user
 */
const StreamChat = ({ streamId, username }) => {
  const socket = useSocket();
  // Fallback username in case the parent doesn't provide one.
  const participantName = username || 'Anonymous';

  // --------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);

  // Refs for auto‑scroll behaviour.
  const chatEndRef = useRef(null);
  const containerRef = useRef(null);

  // --------------------------------------------------------------------
  // WebSocket Lifecycle: Join room, load history, listen for updates
  // --------------------------------------------------------------------
  useEffect(() => {
    // Guard: if the socket isn't ready or no stream is active, do nothing.
    if (!socket || !streamId) return undefined;

    /**
     * Receives the full chat history when first joining the stream.
     * We normalise it to an array to handle edge cases where the server
     * sends `null` or `undefined`.
     */
    const handleAllComments = (allComments) => {
      setComments(Array.isArray(allComments) ? allComments : []);
    };

    /**
     * Appends a newly received comment to the end of the message list.
     */
    const handleNewComment = (comment) => {
      setComments((prev) => [...prev, comment]);
    };

    /**
     * Merges updated fields into an existing comment (e.g., after a like).
     * This avoids replacing the entire array and preserves React keys.
     */
    const handleCommentUpdated = (updatedComment) => {
      setComments((prev) =>
        prev.map((comment) =>
          comment.id === updatedComment.id
            ? { ...comment, ...updatedComment }
            : comment,
        ),
      );
    };

    // Subscribe to WebSocket events for this stream.
    socket.on('all-comments', handleAllComments);
    socket.on('new-comment', handleNewComment);
    socket.on('comment-updated', handleCommentUpdated);

    // Tell the server we've joined this stream's chat room.
    socket.emit('join-stream', streamId);

    // Cleanup: remove listeners when the component unmounts or
    // the streamId/socket changes.
    return () => {
      socket.off('all-comments', handleAllComments);
      socket.off('new-comment', handleNewComment);
      socket.off('comment-updated', handleCommentUpdated);
      // Note: The server should handle room cleanup on disconnect.
      // If explicit leave is required, emit 'leave-stream' here.
    };
  }, [streamId, socket]);

  // --------------------------------------------------------------------
  // Auto‑scroll to bottom when new messages arrive
  // --------------------------------------------------------------------
  useEffect(() => {
    // Scroll the chat container to the bottom every time the
    // comments array changes. This ensures users always see
    // the latest message without manual scrolling.
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [comments]);

  // --------------------------------------------------------------------
  // Event Handlers (memoised for stable references)
  // --------------------------------------------------------------------

  /**
   * Sends a new comment (or reply) to the server.
   * Prevents empty submissions and clears the input on success.
   */
  const handleSendComment = useCallback(
    (event) => {
      event.preventDefault();
      const text = newComment.trim();
      if (!text) return;

      socket.emit('send-comment', {
        streamId,
        username: participantName,
        text,
        // If we're replying, include the target comment's ID so the
        // server can attach the replyTo relationship.
        replyToId: replyingTo?.id,
      });

      setNewComment('');
      setReplyingTo(null);
    },
    [newComment, streamId, participantName, replyingTo, socket],
  );

  /**
   * Toggles a like on a comment for the current user.
   * The server handles deduplication and broadcasts the update.
   */
  const handleLikeComment = useCallback(
    (comment) => {
      socket.emit('toggle-comment-like', {
        streamId,
        commentId: comment.id,
        username: participantName,
      });
    },
    [streamId, participantName, socket],
  );

  // --------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full bg-gray-50/50 dark:bg-gray-900/50 backdrop-blur-md border border-gray-200 dark:border-gray-700 rounded-3xl overflow-hidden shadow-2xl transition-colors duration-300">
      {/* Header: title + live indicator */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-white/50 dark:bg-gray-800/50">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-blue-500" />
          <h4 className="font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider text-xs">
            Live Chat
          </h4>
        </div>
        {/* Animated green dot + "Live" label reassures users the chat is active */}
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-[10px] font-bold text-green-600 dark:text-green-500 uppercase">
            Live
          </span>
        </div>
      </div>

      {/* Scrollable message list */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700 scrollbar-track-transparent"
      >
        <AnimatePresence initial={false}>
          {comments.length === 0 ? (
            // Empty state: friendly invitation to start chatting.
            // Shown when no messages exist yet.
            <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 space-y-3 opacity-50">
              <MessageCircle className="w-12 h-12" />
              <p className="text-sm font-medium">
                Say hello to the community!
              </p>
            </div>
          ) : (
            comments.map((comment, index) => (
              <ChatMessage
                // Prefer the server‑provided ID; fall back to a composite
                // key to prevent React warnings if the ID is missing.
                key={
                  comment.id ||
                  `${comment.timestamp}-${comment.username}-${index}`
                }
                comment={comment}
                isMe={comment.username === participantName}
                // `likedBy` is an object keyed by username; check if the
                // current user has an entry.
                hasLiked={Boolean(comment.likedBy?.[participantName])}
                onLike={handleLikeComment}
                onReply={setReplyingTo}
              />
            ))
          )}
        </AnimatePresence>
        {/* Invisible div at the bottom used as an auto‑scroll target */}
        <div ref={chatEndRef} />
      </div>

      {/* Message input form */}
      <form
        onSubmit={handleSendComment}
        className="p-4 bg-white/50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700"
      >
        {/* Reply preview banner */}
        {replyingTo && (
          <div className="mb-3 flex items-start justify-between gap-3 rounded-2xl border border-blue-500/20 bg-blue-500/10 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-1">
                Replying to {replyingTo.username}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-300 truncate">
                {replyingTo.text}
              </p>
            </div>
            {/* Dismiss button to cancel the reply */}
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Text input with embedded send button */}
        <div className="relative flex items-center group">
          <input
            type="text"
            placeholder={replyingTo ? 'Write a reply...' : 'Type a message...'}
            value={newComment}
            maxLength={500}
            onChange={(event) => setNewComment(event.target.value)}
            className="w-full bg-gray-100 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-sm rounded-2xl py-3 pl-4 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600"
          />
          <button
            type="submit"
            // Disable the send button when the input is empty or only
            // contains whitespace.
            disabled={!newComment.trim()}
            className="absolute right-2 p-2 text-blue-600 hover:text-blue-500 disabled:text-gray-300 dark:disabled:text-gray-700 transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
};

export default StreamChat;