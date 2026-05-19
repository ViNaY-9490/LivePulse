/**
 * -------------------------------------------------------
 * File: components/VideoPlayer.jsx
 * Purpose:
 * Renders a low‑latency live stream viewer using Media
 * Source Extensions (MSE) and a WebSocket for real‑time
 * media delivery.
 *
 * This component is the viewer's window into a live
 * broadcast. It manages the entire lifecycle:
 * WebSocket connection, MediaSource buffer feeding,
 * adaptive latency correction, and UI overlays for
 * buffering, errors, pause state, and viewer count.
 *
 * High‑Level Architecture:
 * 1. Creates a `MediaSource` and attaches it to a
 *    `<video>` element via a Blob URL.
 * 2. On `sourceopen`, negotiates a supported MIME type
 *    (preferring VP8/Opus in WebM) and opens a WebSocket
 *    to the media server as a "viewer".
 * 3. Incoming ArrayBuffer chunks are appended to the
 *    SourceBuffer. A queue absorbs bursts when the buffer
 *    is busy.
 * 4. A 1‑second interval monitor adjusts playback rate
 *    and seeks to keep latency within ~1 second.
 * 5. Listens for signalling events (viewer count, stream
 *    paused/resumed/ended) via the Socket.IO connection.
 * 6. On unmount, performs exhaustive cleanup of all
 *    media resources, listeners, and timers.
 *
 * Critical Design Decisions:
 * - **Queue with back‑pressure**: If the SourceBuffer is
 *   updating, chunks are queued (up to 120 items). The
 *   queue is drained on each `updateend` event. This
 *   prevents data loss during brief decode spikes.
 * - **Latency monitor**: Rather than relying solely on
 *   the browser's built‑in buffering, we actively nudge
 *   playback to stay close to the live edge. Seeking
 *   forward when latency exceeds 1.5s, and subtly
 *   speeding up playback (1.1×) when between 1–1.5s.
 * - **MIME type fallback chain**: Tries VP8+Opus → VP8
 *   only → plain WebM to maximise browser compatibility.
 * - **Auto‑play resilience**: Multiple strategies attempt
 *   to start playback: `loadedmetadata`, `canplay`, and
 *   a pending‑play flag for browsers that block autoplay
 *   until user gesture.
 *
 * Edge Cases Handled:
 * - Browser lacks `MediaSource` → immediate error.
 * - No supported MIME type → error with clear message.
 * - WebSocket drops → error overlay.
 * - SourceBuffer throws on append → chunk is dropped,
 *   playback continues (graceful degradation).
 * - Component unmounts mid‑stream → full teardown with
 *   `disposed` flag to prevent callbacks from mutating
 *   cleaned‑up state.
 * - Stream paused/resumed/ended by broadcaster → UI
 *   overlays update instantly via Socket.IO events.
 *
 * Dependencies:
 * - ../../SocketContext: For signalling events
 * - ../../config/network: `streamWebSocketUrl` helper
 * - lucide-react: For UI icons
 * -------------------------------------------------------
 */

import React, { useEffect, useRef, useState } from 'react';
import { useSocket } from '../../SocketContext';
import { streamWebSocketUrl } from '../../config/network';
import { Users, AlertCircle, RefreshCcw, Pause } from 'lucide-react';

// ----------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------

/**
 * Ordered list of MIME types to try when initialising the SourceBuffer.
 * VP8 + Opus is the preferred choice for broad browser support.
 * Fallbacks handle environments that don't support Opus or codec
 * parameters in the MIME string.
 */
const MIME_TYPE_CANDIDATES = [
  'video/webm; codecs="vp8, opus"',
  'video/webm; codecs="vp8"',
  'video/webm',
];

/**
 * Maximum number of chunks to hold in the append queue.
 * When the SourceBuffer is busy (updating), incoming chunks
 * accumulate here. If the queue grows beyond this limit,
 * the oldest chunk is dropped to prevent memory exhaustion.
 */
const MAX_QUEUE_LENGTH = 120;

// ----------------------------------------------------------------------
// VideoPlayer Component
// ----------------------------------------------------------------------

/**
 * VideoPlayer
 *
 * The viewer‑side video player for a live stream. Manages
 * MSE buffer feeding, latency correction, and connection
 * state overlays.
 *
 * @param {object} props
 * @param {string} props.streamId - Unique identifier for the stream to watch
 */
const VideoPlayer = ({ streamId }) => {
  const socket = useSocket();

  // --------------------------------------------------------------------
  // Refs (for media pipeline; avoid React re‑render overhead)
  // --------------------------------------------------------------------
  const videoRef = useRef(null); // <video> DOM element
  const mediaSourceRef = useRef(null); // MediaSource instance
  const sourceBufferRef = useRef(null); // Single SourceBuffer
  const wsRef = useRef(null); // WebSocket for media data
  const queueRef = useRef([]); // Pending chunks when buffer is busy
  const retryTimeoutRef = useRef(null);

  /**
   * Tracks whether the SourceBuffer has received at least one
   * successful `updateend` after the initial sourceopen.
   * Used to transition out of the "Buffering" overlay.
   */
  const hasInitializedRef = useRef(false);

  /**
   * When autoplay is blocked by the browser, this flag is set
   * so that playback can be attempted again on the next
   * `loadedmetadata` or `canplay` event.
   */
  const pendingPlayRef = useRef(false);

  /**
   * Suppresses repeated console warnings for the same playback
   * failure (e.g., if autoplay is blocked, we log once rather
   * than spamming the console on every event).
   */
  const playbackWarningShownRef = useRef(false);

  // --------------------------------------------------------------------
  // UI State
  // --------------------------------------------------------------------
  const [isWaiting, setIsWaiting] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [error, setError] = useState(null);
  const [reconnectKey, setReconnectKey] = useState(0);

  // --------------------------------------------------------------------
  // Main Media Pipeline Effect
  // --------------------------------------------------------------------

  useEffect(() => {
    /**
     * `disposed` flag prevents any callback from mutating state
     * or refs after the component has unmounted. This is the
     * standard pattern for async teardown safety.
     */
    let disposed = false;

    // Reset all state for a fresh connection.
    setIsWaiting(true);
    setIsPaused(false);
    setError(null);
    setViewers(0);
    queueRef.current = [];
    hasInitializedRef.current = false;
    pendingPlayRef.current = false;
    playbackWarningShownRef.current = false;

    // ---- Capability Check ----
    if (!window.MediaSource) {
      setIsWaiting(false);
      setError('This browser does not support live stream playback.');
      return undefined;
    }

    // ---- MediaSource Setup ----
    const mediaSource = new MediaSource();
    const objectUrl = URL.createObjectURL(mediaSource);
    mediaSourceRef.current = mediaSource;

    // ------------------------------------------------------------------
    // Playback Helpers
    // ------------------------------------------------------------------

    const triggerReconnect = () => {
      if (disposed) return;
      setReconnectKey(prev => prev + 1);
    };

    /**
     * Attempts to start video playback. Handles the case where
     * the browser blocks autoplay by setting a pending flag
     * that is retried on subsequent `loadedmetadata` / `canplay`
     * events.
     */
    const requestPlayback = () => {
      const video = videoRef.current;
      if (disposed || !video || video.error) return;

      // If metadata hasn't loaded yet, defer playback.
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
        pendingPlayRef.current = true;
        return;
      }

      pendingPlayRef.current = false;
      if (!video.paused) return; // Already playing.

      video.play().catch((err) => {
        if (disposed || err.name === 'AbortError') return;

        // Browsers often reject autoplay with NotAllowedError.
        // We defer and retry rather than showing an error.
        if (err.name === 'NotAllowedError') {
          pendingPlayRef.current = true;
          return;
        }

        // Log other playback failures once per session.
        if (!playbackWarningShownRef.current) {
          playbackWarningShownRef.current = true;
          console.warn('[Player] Playback failed:', err.message);
        }
      });
    };

    // ------------------------------------------------------------------
    // Chunk Queue Management
    // ------------------------------------------------------------------

    /**
     * Adds a chunk to the append queue. If the queue exceeds
     * `MAX_QUEUE_LENGTH`, the oldest chunk is dropped to
     * prevent memory exhaustion during extended buffering.
     *
     * @param {ArrayBuffer} chunk - Raw media data from WebSocket
     */
    const queueChunk = (chunk) => {
      if (queueRef.current.length >= MAX_QUEUE_LENGTH) {
        queueRef.current.shift();
      }
      queueRef.current.push(chunk);
    };

    /**
     * Drains the chunk queue into the SourceBuffer.
     * Called on every `updateend` event and during initial
     * append attempts. Only processes one chunk per call
     * to respect the SourceBuffer's single‑operation
     * constraint.
     */
    const drainQueue = () => {
      const sourceBuffer = sourceBufferRef.current;
      const activeMediaSource = mediaSourceRef.current;

      if (
        disposed ||
        !sourceBuffer ||
        sourceBuffer.updating ||
        activeMediaSource?.readyState !== 'open' ||
        queueRef.current.length === 0
      ) {
        return;
      }

      const chunk = queueRef.current[0];

      try {
        sourceBuffer.appendBuffer(chunk);
        queueRef.current.shift();
      } catch (err) {
        // If a chunk fails to append, we drop it and move on.
        // This is a graceful degradation: the stream may glitch
        // briefly but won't stall permanently.
        queueRef.current.shift();
        console.warn('[Player] Buffer append failed:', err.message);
      }
    };

    /**
     * Attempts to append a chunk directly to the SourceBuffer.
     * If the buffer is busy or not ready, the chunk is qeued
     * instead.
     *
     * @param {ArrayBuffer} chunk - Raw media data
     */
    const appendChunk = (chunk) => {
      const sourceBuffer = sourceBufferRef.current;
      const activeMediaSource = mediaSourceRef.current;

      // Queue if: no buffer, buffer is updating, MediaSource isn't open,
      // or there are already queued chunks (maintains ordering).
      if (
        !sourceBuffer ||
        sourceBuffer.updating ||
        activeMediaSource?.readyState !== 'open' ||
        queueRef.current.length > 0
      ) {
        queueChunk(chunk);
        return;
      }

      try {
        sourceBuffer.appendBuffer(chunk);
      } catch (err) {
        queueChunk(chunk);
      }
    };

    // ------------------------------------------------------------------
    // SourceBuffer Event Handlers
    // ------------------------------------------------------------------

    /**
     * Called when the SourceBuffer finishes appending a chunk.
     * On first success, transitions out of the buffering state.
     * Then drains any queued chunks and attempts playback.
     */
    const handleSourceBufferUpdateEnd = () => {
      if (!hasInitializedRef.current) {
        hasInitializedRef.current = true;
        setIsWaiting(false);
      }

      drainQueue();
      requestPlayback();
    };

    /**
     * Called when the SourceBuffer encounters a fatal error
     * (e.g., the media format is unparseable). This is distinct
     * from transient append errors caught in `appendChunk`.
     */
    const handleSourceBufferError = () => {
      if (disposed) return;
      setIsWaiting(false);
      setError('The stream data could not be decoded by this browser.');
    };

    // ------------------------------------------------------------------
    // MediaSource `sourceopen` Handler
    // ------------------------------------------------------------------

    /**
     * Fires when the MediaSource is ready to accept SourceBuffers.
     * Negotiates a MIME type, creates the SourceBuffer, opens the
     * media WebSocket, and wires up all data flow.
     */
    const onSourceOpen = () => {
      if (disposed) return;

      // Find the first MIME type the browser supports.
      const mimeType = MIME_TYPE_CANDIDATES.find((candidate) =>
        MediaSource.isTypeSupported(candidate),
      );

      if (!mimeType) {
        setError('This browser does not support WebM live stream playback.');
        setIsWaiting(false);
        return;
      }

      try {
        const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        sourceBuffer.mode = 'sequence'; // Append chunks in order
        sourceBufferRef.current = sourceBuffer;

        sourceBuffer.addEventListener('updateend', handleSourceBufferUpdateEnd);
        sourceBuffer.addEventListener('error', handleSourceBufferError);

        // ---- Media WebSocket ----
        const ws = new WebSocket(
          streamWebSocketUrl({ type: 'viewer', streamId }),
        );
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        /**
         * Receives raw media chunks and feeds them into the
         * append pipeline.
         */
        ws.onmessage = (event) => {
          if (disposed) return;
          if (
            !(event.data instanceof ArrayBuffer) ||
            event.data.byteLength === 0
          )
            return;
          appendChunk(event.data);
        };

        ws.onclose = (event) => {
          if (disposed) return;
          
          // If closed gracefully by server or by us (stream ended/restarted), 
          // don't auto-retry here; signalling events handle that.
          if (event.code === 1000 || event.code === 1001) return;

          console.warn('[Player] Media WebSocket closed unexpectedly. Retrying in 3s...');
          setIsWaiting(true);
          
          // Clear any existing timeout
          if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
          
          retryTimeoutRef.current = setTimeout(() => {
            triggerReconnect();
          }, 3000);
        };

        ws.onerror = () => {
          if (disposed) return;
          console.error('[Player] Media WebSocket error.');
        };
      } catch (err) {
        setIsWaiting(false);
        setError('Buffer initialization failed.');
      }
    };

    // ------------------------------------------------------------------
    // Signalling Event Handlers (Socket.IO)
    // ------------------------------------------------------------------

    const handleViewerCount = (count) => setViewers(Number(count) || 0);

    const handleStreamEnded = (payload) => {
      // Only react if this event is for our stream.
      if (payload?.streamId && payload.streamId !== streamId) return;

      setIsWaiting(false);
      setError('Stream has ended.');
      wsRef.current?.close();
    };

    /**
     * Called when the broadcaster reconnects or restarts the stream.
     * We perform a "hard reset" by incrementing reconnectKey, 
     * which re-runs this entire useEffect.
     */
    const handleStreamRestarted = (payload) => {
      if (payload?.streamId && payload.streamId !== streamId) return;
      console.log('[Player] Stream restarted. Performing hard reset...');
      triggerReconnect();
    };

    const handleStreamPaused = (payload) => {
      if (payload?.streamId && payload.streamId !== streamId) return;
      setIsPaused(true);
      setIsWaiting(false);
    };

    const handleStreamResumed = (payload) => {
      if (payload?.streamId && payload.streamId !== streamId) return;
      setIsPaused(false);
    };

    // ------------------------------------------------------------------
    // Video Element Event Handlers
    // ------------------------------------------------------------------

    const handleVideoReady = () => {
      if (pendingPlayRef.current) requestPlayback();
    };

    const handleVideoError = () => {
      if (disposed) return;
      setIsWaiting(false);
      setError('The browser could not load this live stream source.');
    };

    // ------------------------------------------------------------------
    // Wire Everything Together
    // ------------------------------------------------------------------

    mediaSource.addEventListener('sourceopen', onSourceOpen);

    const video = videoRef.current;
    if (video) {
      // Mute by default so autoplay policies are more lenient.
      video.defaultMuted = true;
      video.muted = true;
      video.src = objectUrl;
      video.addEventListener('loadedmetadata', handleVideoReady);
      video.addEventListener('canplay', handleVideoReady);
      video.addEventListener('error', handleVideoError);
    }

    socket.emit('join-stream', streamId);
    socket.on('viewer-count', handleViewerCount);
    socket.on('stream-ended', handleStreamEnded);
    socket.on('stream-restarted', handleStreamRestarted);
    socket.on('stream-paused', handleStreamPaused);
    socket.on('stream-resumed', handleStreamResumed);

    // ------------------------------------------------------------------
    // Latency Monitor (Adaptive Sync) & Buffer Eviction
    // ------------------------------------------------------------------

    /**
     * Runs every second to keep playback close to the live edge
     * and prevent the SourceBuffer from growing indefinitely.
     */
    const monitor = setInterval(() => {
      const video = videoRef.current;
      const sourceBuffer = sourceBufferRef.current;
      if (!video || video.buffered.length === 0) return;

      const lastBuffered = video.buffered.end(video.buffered.length - 1);
      const firstBuffered = video.buffered.start(0);
      const latency = lastBuffered - video.currentTime;

      // ---- Latency Correction ----
      if (latency > 1.5) {
        video.currentTime = Math.max(0, lastBuffered - 0.5);
      } else if (latency > 1.0) {
        video.playbackRate = 1.1;
      } else {
        video.playbackRate = 1.0;
      }

      // ---- Buffer Eviction (Memory Management) ----
      // If we have more than 60 seconds of buffered data behind us,
      // remove it to prevent QuotaExceededError.
      if (
        sourceBuffer &&
        !sourceBuffer.updating &&
        video.currentTime - firstBuffered > 60
      ) {
        try {
          // Remove from start of buffer up to 30s before current playhead
          sourceBuffer.remove(0, video.currentTime - 30);
        } catch (err) {
          console.warn('[Player] Buffer eviction failed:', err.message);
        }
      }
    }, 1000);

    // ------------------------------------------------------------------
    // Cleanup
    // ------------------------------------------------------------------

    return () => {
      disposed = true;
      clearInterval(monitor);
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);

      // Notify server we're leaving.
      socket.emit('leave-stream', streamId);
      socket.off('viewer-count', handleViewerCount);
      socket.off('stream-ended', handleStreamEnded);
      socket.off('stream-restarted', handleStreamRestarted);
      socket.off('stream-paused', handleStreamPaused);
      socket.off('stream-resumed', handleStreamResumed);

      // Close media WebSocket.
      wsRef.current?.close();
      wsRef.current = null;

      // Remove SourceBuffer listeners.
      const sourceBuffer = sourceBufferRef.current;
      if (sourceBuffer) {
        sourceBuffer.removeEventListener(
          'updateend',
          handleSourceBufferUpdateEnd,
        );
        sourceBuffer.removeEventListener('error', handleSourceBufferError);
      }
      mediaSource.removeEventListener('sourceopen', onSourceOpen);

      // End the stream if it's still open.
      if (mediaSource.readyState === 'open') {
        try {
          mediaSource.endOfStream();
        } catch {
          // MediaSource may already be closing; ignore.
        }
      }

      // Clean up the video element.
      if (videoRef.current) {
        videoRef.current.removeEventListener(
          'loadedmetadata',
          handleVideoReady,
        );
        videoRef.current.removeEventListener('canplay', handleVideoReady);
        videoRef.current.removeEventListener('error', handleVideoError);
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }

      // Revoke the Blob URL to free memory.
      URL.revokeObjectURL(objectUrl);

      // Null out refs.
      sourceBufferRef.current = null;
      mediaSourceRef.current = null;
      queueRef.current = [];
    };
  }, [socket, streamId, reconnectKey]);

  // --------------------------------------------------------------------
  // Manual Sync Handler
  // --------------------------------------------------------------------

  /**
   * Allows the viewer to manually jump closer to the live edge.
   * Useful as a fallback if the automatic latency monitor isn't
   * keeping up, or after a period of buffering.
   */
  const handleManualSync = () => {
    const video = videoRef.current;
    if (!video || video.buffered.length === 0) return;

    const lastBuffered = video.buffered.end(video.buffered.length - 1);
    video.currentTime = Math.max(0, lastBuffered - 0.5);
    video.play().catch(() => {});
  };

  // --------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------
  return (
    <div className="relative group bg-black rounded-3xl overflow-hidden shadow-2xl ring-1 ring-gray-800 transition-all hover:ring-gray-700">
      <div className="aspect-video relative">
        {/* Video element: always mounted so the MediaSource pipeline
            can attach even while overlays are shown. */}
        <video
          ref={videoRef}
          playsInline // Required for iOS inline playback
          autoPlay
          controls
          className="w-full h-full object-contain"
        />

        {/* ---- Buffering Overlay ---- */}
        {isWaiting && !error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-900/90 backdrop-blur-sm transition-all duration-500">
            {/* Spinner */}
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full" />
              <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="mt-6 text-gray-300 font-medium tracking-widest text-xs uppercase animate-pulse">
              Buffering Stream...
            </p>
            {/* Manual sync button visible during buffering */}
            <button
              onClick={handleManualSync}
              className="mt-8 flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold rounded-full transition-all border border-gray-700"
            >
              <RefreshCcw className="w-3.5 h-3.5" />
              Force Sync
            </button>
          </div>
        )}

        {/* ---- Error Overlay ---- */}
        {error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-red-950/40 backdrop-blur-md">
            <div className="bg-red-500/10 p-4 rounded-full mb-4">
              <AlertCircle className="w-10 h-10 text-red-500" />
            </div>
            <p className="text-red-200 font-bold text-lg mb-6">{error}</p>
            <button
              onClick={handleManualSync}
              className="flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-full transition-all shadow-lg shadow-red-900/40"
            >
              <RefreshCcw className="w-4 h-4" />
              Sync Player
            </button>
          </div>
        )}

        {/* ---- Paused Overlay ---- */}
        {isPaused && !error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-amber-500/10 p-5 rounded-full mb-4">
              <Pause className="w-10 h-10 text-amber-400" />
            </div>
            <p className="text-white font-black text-xl">Stream Paused</p>
            <p className="text-gray-300 text-sm mt-2">
              The broadcast will continue when the streamer resumes.
            </p>
          </div>
        )}

        {/* ---- Status Badges (top‑left) ---- */}
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2 pointer-events-none">
          {/* Live / Paused badge */}
          <div
            className={`flex items-center gap-1.5 text-white px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter shadow-lg ring-1 ${
              isPaused
                ? 'bg-amber-600 ring-amber-400/50'
                : 'bg-red-600 ring-red-400/50'
            }`}
          >
            <div
              className={`w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_8px_white] ${
                isPaused ? '' : 'animate-pulse'
              }`}
            />
            {isPaused ? 'Paused' : 'Live'}
          </div>

          {/* Viewer count badge */}
          <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md text-white px-2.5 py-1 rounded-md text-[10px] font-bold shadow-lg ring-1 ring-white/10">
            <Users className="w-3 h-3 text-blue-400" />
            {viewers}{' '}
            <span className="text-gray-400 ml-0.5 font-medium">Viewing</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;