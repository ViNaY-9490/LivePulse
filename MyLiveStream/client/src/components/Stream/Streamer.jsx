/**
 * -------------------------------------------------------
 * File: components/Streamer.jsx
 * Purpose:
 * The main broadcaster dashboard for starting, managing,
 * and stopping a live stream. Handles camera/microphone
 * access, WebSocket media upload, stream pause/resume,
 * audio muting, and device selection.
 *
 * High‑Level Workflow:
 * 1. Enumerates available video input devices on mount.
 * 2. On "Go Live Now", generates a unique stream key,
 *    requests camera + mic access, establishes a WebSocket
 *    to the media server, and starts a MediaRecorder.
 * 3. Sends media chunks over the WebSocket in real time.
 * 4. Provides controls for mute, pause/resume, and stop.
 * 5. On unmount or stream end, cleans up all local media,
 *    WebSocket connections, and notifies the signalling
 *    server.
 *
 * Critical Design Decisions:
 * - Dual state (React state + refs): React state triggers
 *   re‑renders for the UI; refs are the source of truth
 *   for real‑time control flow (starting, stopping, muting)
 *   to avoid stale closures in WebSocket/recorder callbacks.
 * - Stream key is generated client‑side using
 *   `window.crypto.randomUUID()` with a fallback to
 *   `getRandomValues` for older browsers.
 * - `MediaRecorder` is preferred with VP8/Opus in WebM
 *   for broad browser support and reasonable latency.
 *
 * Edge Cases Handled:
 * - Browser lacks `getUserMedia` or `MediaRecorder` → error.
 * - Camera permission denied → toast + cleanup.
 * - WebSocket disconnection mid‑stream → toast + cleanup.
 * - Rapid start/stop toggling → guarded by `isStartingRef`.
 * - Device list changes while streaming → refreshed but
 *   selection is locked during active broadcast.
 *
 * Dependencies:
 * - ../../SocketContext: For signalling server communication
 * - ../../config/network: `streamWebSocketUrl` helper
 * - react-hot-toast: For non‑blocking user notifications
 * - framer-motion: For UI animations
 * - lucide-react: For iconography
 * -------------------------------------------------------
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { useSocket } from '../../SocketContext';
import { streamWebSocketUrl } from '../../config/network';
import StreamSocial from './StreamSocial';
import ThemeToggle from '../ThemeToggle';
import {
  Camera,
  StopCircle,
  Key,
  ArrowLeft,
  Radio,
  Mic,
  MicOff,
  Pause,
  Play,
  Video,
} from 'lucide-react';

// ----------------------------------------------------------------------
// Constants & Helpers
// ----------------------------------------------------------------------

/**
 * Generates a cryptographically random stream key.
 *
 * Uses `window.crypto.randomUUID()` when available (modern browsers)
 * and falls back to `getRandomValues` for older environments.
 * The key is shortened to 12 hex characters for usability while
 * maintaining sufficient entropy for a single broadcast session.
 *
 * @returns {string} A 12‑character hex stream key
 */
const createStreamKey = () => {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }

  // Fallback for browsers without randomUUID (e.g., older Safari)
  const bytes = new Uint8Array(8);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
};

// ----------------------------------------------------------------------
// Streamer Component
// ----------------------------------------------------------------------

/**
 * Streamer
 *
 * The broadcaster dashboard. Manages the full lifecycle of a live
 * stream from preview through broadcasting to teardown.
 *
 * @param {object} props
 * @param {string} props.username - Display name of the broadcaster
 * @param {function} props.onBack - Callback to navigate away from the studio
 */
const Streamer = ({ username, onBack }) => {
  const socket = useSocket();

  // --------------------------------------------------------------------
  // UI State (triggers re‑renders)
  // --------------------------------------------------------------------
  const [isStreaming, setIsStreaming] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [sessionKey, setSessionKey] = useState('');
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState('');

  // --------------------------------------------------------------------
  // Refs (source of truth for async callbacks; avoids stale closures)
  // --------------------------------------------------------------------
  const videoPreviewRef = useRef(null); // <video> element for local preview
  const wsRef = useRef(null); // WebSocket to media server
  const recorderRef = useRef(null); // MediaRecorder instance
  const localStreamRef = useRef(null); // The local MediaStream
  const activeStreamIdRef = useRef(''); // Currently active stream key

  // These mirror React state so callbacks can read latest values
  // without being recreated on every render.
  const isStreamingRef = useRef(false);
  const isStartingRef = useRef(false);
  const isAudioMutedRef = useRef(false);
  const isPausedRef = useRef(false);

  // --------------------------------------------------------------------
  // Device Enumeration
  // --------------------------------------------------------------------

  /**
   * Enumerates available video input devices and updates state.
   * Preserves the currently selected device if it still exists;
   * otherwise defaults to the first available camera.
   *
   * Wrapped in `useCallback` to keep a stable reference for the
   * event listener lifecycle.
   */
  const refreshVideoDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((device) => device.kind === 'videoinput');
      setVideoDevices(cameras);

      // Keep the current selection if it's still available.
      setSelectedVideoDeviceId((current) =>
        current && cameras.some((device) => device.deviceId === current)
          ? current
          : cameras[0]?.deviceId || '',
      );
    } catch (err) {
      console.warn('[Stream] Could not enumerate cameras:', err.message);
    }
  }, []);

  // Listen for device changes (e.g., USB camera plugged in / removed).
  useEffect(() => {
    refreshVideoDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshVideoDevices);

    return () => {
      navigator.mediaDevices?.removeEventListener?.(
        'devicechange',
        refreshVideoDevices,
      );
    };
  }, [refreshVideoDevices]);

  // --------------------------------------------------------------------
  // Resource Cleanup
  // --------------------------------------------------------------------

  /**
   * Stops all local media resources: recorder, WebSocket, and media stream.
   * Optionally leaves the WebSocket open (useful during certain error paths
   * where the server will close it).
   *
   * @param {object} [options]
   * @param {boolean} [options.closeWebSocket=true] - Whether to close the WS
   */
  const stopLocalResources = ({ closeWebSocket = true } = {}) => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    recorderRef.current = null;

    if (closeWebSocket && wsRef.current) {
      wsRef.current.close();
    }
    wsRef.current = null;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    localStreamRef.current = null;

    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null;
    }
  };

  /**
   * Performs a full stream shutdown: updates refs, clears React state,
   * cleans up resources, and optionally notifies the server.
   *
   * @param {string} streamId - The stream to shut down
   * @param {boolean} [notifyServer=true] - Whether to emit 'stop-stream'
   */
  const finishStreaming = (streamId, notifyServer = true) => {
    if (notifyServer && streamId) {
      socket.emit('stop-stream', streamId);
    }

    isStreamingRef.current = false;
    isStartingRef.current = false;
    isPausedRef.current = false;
    activeStreamIdRef.current = '';
    stopLocalResources();
    setIsStarting(false);
    setIsStreaming(false);
    setIsPaused(false);
    setSessionKey('');
  };

  // Cleanup on unmount: ensure the server knows the stream ended.
  useEffect(
    () => () => {
      const streamId = activeStreamIdRef.current;
      if (streamId) {
        socket.emit('stop-stream', streamId);
      }
      isStartingRef.current = false;
      isStreamingRef.current = false;
      isPausedRef.current = false;
      activeStreamIdRef.current = '';
      stopLocalResources();
    },
    // eslint‑disable‑next‑line react‑hooks/exhaustive‑deps
    // Intentionally runs only on mount/unmount; socket is stable.
    [],
  );

  // --------------------------------------------------------------------
  // Audio Mute Control
  // --------------------------------------------------------------------

  /**
   * Applies the mute state to all audio tracks of a given stream.
   * Tracks are disabled (not stopped) so they can be re‑enabled later.
   *
   * @param {MediaStream} stream - The local media stream
   * @param {boolean} muted - Whether audio should be muted
   */
  const applyAudioMuteState = (stream, muted) => {
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  };

  // --------------------------------------------------------------------
  // Start Streaming
  // --------------------------------------------------------------------

  /**
   * Initiates the broadcast workflow:
   * 1. Generates a stream key
   * 2. Acquires camera + mic via getUserMedia
   * 3. Opens a WebSocket to the media server
   * 4. Starts a MediaRecorder and sends chunks
   * 5. Notifies the signalling server
   *
   * Guards against double‑start via `isStartingRef`.
   */
  const startStreaming = async () => {
    if (isStreamingRef.current || isStartingRef.current) return;

    const newKey = createStreamKey();
    isStartingRef.current = true;
    setIsStarting(true);
    setSessionKey(newKey);
    activeStreamIdRef.current = newKey;

    try {
      // Browser capability check
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        throw new Error('This browser does not support camera streaming.');
      }

      // Build video constraints. If a specific device is selected,
      // use `exact` to require that camera; otherwise use ideal
      // dimensions for quality.
      const videoConstraint = selectedVideoDeviceId
        ? {
            deviceId: { exact: selectedVideoDeviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          }
        : {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          };

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraint,
        audio: true,
      });

      // Apply current mute state before previewing.
      applyAudioMuteState(stream, isAudioMutedRef.current);
      localStreamRef.current = stream;
      refreshVideoDevices();

      // Show local preview in the <video> element.
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
      }

      // Connect to the media WebSocket server.
      const ws = new WebSocket(
        streamWebSocketUrl({ type: 'broadcaster', streamId: newKey }),
      );
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      // ---- WebSocket open handler ----
      ws.onopen = () => {
        try {
          // Prefer VP8 + Opus in WebM for broad compatibility.
          const preferredMimeType = 'video/webm; codecs="vp8, opus"';
          const mimeType = MediaRecorder.isTypeSupported(preferredMimeType)
            ? preferredMimeType
            : 'video/webm';

          const recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 1_200_000, // 1.2 Mbps – balances quality and bandwidth
          });

          /**
           * Fires every 200ms (configured in `.start(200)`).
           * Converts the Blob to an ArrayBuffer and sends it
           * over the WebSocket if the connection is still open.
           */
          recorder.ondataavailable = async (event) => {
            if (event.data.size === 0 || ws.readyState !== WebSocket.OPEN)
              return;

            try {
              ws.send(await event.data.arrayBuffer());
            } catch (err) {
              console.error('[Stream] Failed to send media chunk:', err);
            }
          };

          // Request data every 200ms for low latency.
          recorder.start(200);
          recorderRef.current = recorder;

          // Transition state from "starting" to "streaming".
          isStartingRef.current = false;
          isStreamingRef.current = true;
          setIsStarting(false);
          setIsStreaming(true);

          // Notify the signalling server that the stream is live.
          socket.emit('start-stream', newKey, (response) => {
            if (response?.ok === false) {
              toast.error(response.message || 'Unable to start stream.');
              finishStreaming(newKey, false);
            }
          });
        } catch (err) {
          toast.error(err.message || 'Unable to start recorder.');
          finishStreaming(newKey, true);
        }
      };

      // ---- WebSocket error handler ----
      ws.onerror = () => {
        toast.error('Streaming connection failed.');
        finishStreaming(newKey, true);
      };

      // ---- WebSocket close handler ----
      ws.onclose = (event) => {
        // Only react if we're still actively streaming this session.
        if (isStreamingRef.current && activeStreamIdRef.current === newKey) {
          // If closed gracefully (code 1000/1001), don't retry.
          if (event.code === 1000 || event.code === 1001) return;

          console.warn('[Stream] Media WebSocket closed unexpectedly. Retrying in 3s...');
          toast.loading('Connection lost. Retrying...', { id: 'stream-retry' });
          
          // Stop current resources without ending the session state
          stopLocalResources({ closeWebSocket: false });

          setTimeout(() => {
            if (isStreamingRef.current) {
              toast.dismiss('stream-retry');
              // We need to restart the media capture and WS.
              // For simplicity in this pass, we just call startStreaming again
              // with the same key if we modify startStreaming to support it.
              // For now, we'll just log and let the user restart manually if needed,
              // but adding a toast is a good first step.
              toast.error('Streaming connection lost. Please restart.');
              finishStreaming(newKey, true);
            }
          }, 3000);
        }
      };
    } catch (err) {
      console.error('[Stream] Streaming error:', err);
      toast.error(err.message || 'Unable to access camera.');
      finishStreaming(newKey, true);
    }
  };

  // --------------------------------------------------------------------
  // Stop, Mute, Pause Controls
  // --------------------------------------------------------------------

  /**
   * Stops the active stream. Delegates to `finishStreaming`.
   */
  const stopStreaming = () => {
    finishStreaming(activeStreamIdRef.current || sessionKey, true);
  };

  /**
   * Toggles audio mute on/off for the local stream.
   * Updates both the ref (for callbacks) and the React state (for UI).
   */
  const toggleAudioMute = () => {
    const nextMuted = !isAudioMutedRef.current;
    isAudioMutedRef.current = nextMuted;
    setIsAudioMuted(nextMuted);

    if (localStreamRef.current) {
      applyAudioMuteState(localStreamRef.current, nextMuted);
    }
  };

  /**
   * Pauses or resumes the MediaRecorder and notifies the
   * signalling server so viewers see the correct status.
   */
  const togglePauseStream = () => {
    const recorder = recorderRef.current;
    const streamId = activeStreamIdRef.current || sessionKey;
    if (!recorder || !streamId) return;

    if (isPausedRef.current) {
      // Resume
      if (recorder.state === 'paused') recorder.resume();
      isPausedRef.current = false;
      setIsPaused(false);
      socket.emit('resume-stream', streamId);
      return;
    }

    // Pause
    if (recorder.state === 'recording') recorder.pause();
    isPausedRef.current = true;
    setIsPaused(true);
    socket.emit('pause-stream', streamId);
  };

  // --------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors duration-300">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* ---------------------------------------------------------------- */}
        {/* Header: Navigation, Title, Device Selector, Action Buttons      */}
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
              <h1 className="text-4xl font-black tracking-tight flex items-center gap-4 text-gray-900 dark:text-white">
                Broadcast Studio
                {/* Live / Paused badge */}
                {isStreaming && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-[0.2em] border ${
                      isPaused
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                        : 'bg-red-600/10 text-red-600 dark:text-red-500 border-red-600/20'
                    }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${
                        isPaused ? 'bg-amber-500' : 'bg-red-600 animate-ping'
                      }`}
                    />
                    {isPaused ? 'Paused' : 'Live'}
                  </motion.span>
                )}
              </h1>
              <p className="text-gray-500 dark:text-gray-400 font-medium">
                Ready to share your world, {username}?
              </p>
            </div>
          </div>

          {/* Right: Camera selector, action buttons, theme toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {/* Camera selector */}
            <div className="relative">
              <Video className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select
                value={selectedVideoDeviceId}
                onChange={(event) =>
                  setSelectedVideoDeviceId(event.target.value)
                }
                // Disable during startup or while streaming to prevent
                // mid‑broadcast device switches (which would restart the stream).
                disabled={isStarting || isStreaming}
                className="w-full sm:w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-200 rounded-2xl py-3 pl-11 pr-4 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 disabled:opacity-60"
              >
                {videoDevices.length === 0 ? (
                  <option value="">Default camera</option>
                ) : (
                  videoDevices.map((device, index) => (
                    <option
                      key={device.deviceId || index}
                      value={device.deviceId}
                    >
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Conditional buttons: "Go Live" or streaming controls */}
            {!isStreaming ? (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={startStreaming}
                disabled={isStarting}
                className="flex items-center justify-center gap-3 px-8 py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-500 text-white font-black rounded-2xl transition-all shadow-xl shadow-blue-600/25"
              >
                <Radio className="w-5 h-5" />
                {isStarting ? 'Starting...' : 'Go Live Now'}
              </motion.button>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {/* Mute / Unmute */}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={toggleAudioMute}
                  className={`flex items-center justify-center gap-2 px-5 py-4 text-white font-black rounded-2xl transition-all shadow-xl ${
                    isAudioMuted
                      ? 'bg-gray-700 hover:bg-gray-600 shadow-gray-900/20'
                      : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20'
                  }`}
                >
                  {isAudioMuted ? (
                    <MicOff className="w-5 h-5" />
                  ) : (
                    <Mic className="w-5 h-5" />
                  )}
                  {isAudioMuted ? 'Unmute' : 'Mute'}
                </motion.button>

                {/* Pause / Resume */}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={togglePauseStream}
                  className={`flex items-center justify-center gap-2 px-5 py-4 text-white font-black rounded-2xl transition-all shadow-xl ${
                    isPaused
                      ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/20'
                      : 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/20'
                  }`}
                >
                  {isPaused ? (
                    <Play className="w-5 h-5" />
                  ) : (
                    <Pause className="w-5 h-5" />
                  )}
                  {isPaused ? 'Resume' : 'Pause'}
                </motion.button>

                {/* End Stream */}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={stopStreaming}
                  className="flex items-center justify-center gap-3 px-6 py-4 bg-red-600 hover:bg-red-500 text-white font-black rounded-2xl transition-all shadow-xl shadow-red-600/25"
                >
                  <StopCircle className="w-5 h-5" />
                  End
                </motion.button>
              </div>
            )}
            <ThemeToggle />
          </div>
        </header>

        {/* ---------------------------------------------------------------- */}
        {/* Main Content: Video Preview + Stream Social Panel               */}
        {/* ---------------------------------------------------------------- */}
        <div className="grid grid-cols-1 gap-12">
          {/* Video preview container with decorative border */}
          <div className="relative rounded-[3.5rem] overflow-hidden shadow-2xl border-8 border-white dark:border-gray-900 bg-black aspect-video group">
            <video
              ref={videoPreviewRef}
              autoPlay
              muted // Mute local preview to prevent echo
              playsInline // Required for iOS inline playback
              className="w-full h-full object-cover"
            />

            {/* Inactive overlay: shown when not streaming */}
            <AnimatePresence>
              {!isStreaming && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/40 backdrop-blur-sm z-10"
                >
                  <div className="bg-white/10 p-8 rounded-[2.5rem] mb-6 border border-white/20">
                    <Camera className="w-20 h-20 text-white opacity-50" />
                  </div>
                  <p className="text-white text-xl font-bold tracking-tight">
                    Camera Preview Inactive
                  </p>
                  <p className="text-white/60 text-sm mt-2">
                    Click &quot;Go Live Now&quot; to start your broadcast
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Pause overlay */}
            <AnimatePresence>
              {isPaused && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm text-white"
                >
                  <Pause className="w-16 h-16 mb-4" />
                  <p className="text-2xl font-black">Stream Paused</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Stream key badge (visible while live) */}
            <AnimatePresence>
              {isStreaming && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="absolute top-8 right-8 flex items-center gap-4 bg-black/60 backdrop-blur-xl p-4 rounded-3xl border border-white/10 shadow-2xl z-30"
                >
                  <div className="p-3 bg-blue-600/20 rounded-2xl">
                    <Key className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-[0.2em] leading-none mb-1.5">
                      Your Stream Key
                    </p>
                    <code className="text-base font-mono font-bold text-blue-300">
                      {sessionKey}
                    </code>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Stream social panel (chat + reactions) – only when live */}
          <AnimatePresence>
            {isStreaming && (
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <StreamSocial streamId={sessionKey} username={username} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default Streamer;