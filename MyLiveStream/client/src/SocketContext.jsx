/**
 * -------------------------------------------------------
 * File: SocketContext.jsx
 * Purpose:
 * Provides a singleton Socket.IO client instance to the
 * entire application via React Context. Manages the
 * WebSocket lifecycle and exposes a convenient hook
 * (`useSocket`) for components to access the socket.
 *
 * This context is the single entry point for all real‑time
 * communication: chat messages, stream reactions, viewer
 * counts, interaction toggles, and stream lifecycle events.
 *
 * High‑Level Architecture:
 * 1. A single Socket.IO client is created at module scope
 *    (outside React's render cycle) to ensure exactly one
 *    connection exists for the entire application lifetime.
 * 2. `SocketProvider` mounts connection event listeners
 *    for logging and debugging, and cleans them up on
 *    unmount.
 * 3. The socket instance is passed through context so any
 *    component in the tree can access it via `useSocket()`.
 *
 * Design Decisions:
 * - **Module‑scoped socket:** Creating the socket outside
 *   the component prevents re‑connection when the provider
 *   re‑renders. The socket persists for the full page
 *   lifecycle, which matches user expectations (they stay
 *   connected as they navigate between pages).
 * - **Transports: `['websocket', 'polling']`:** WebSocket
 *   is tried first for performance; polling is the fallback
 *   for environments where WebSocket connections are
 *   blocked (corporate firewalls, certain proxies).
 * - **`reconnection: true` + `reconnectionAttempts: Infinity`:**
 *   The client will keep trying to reconnect indefinitely
 *   with a 2‑second delay between attempts. This is
 *   appropriate for a real‑time streaming app where
 *   connectivity is critical.
 * - **`withCredentials: true`:** Allows the server to
 *   authenticate the socket connection via cookies if
 *   needed (e.g., for sticky sessions behind a load
 *   balancer).
 * - **`autoConnect: true`:** The socket connects immediately
 *   when the module loads. No explicit `.connect()` call
 *   is needed.
 *
 * Why a custom hook (`useSocket`):
 * - Encapsulates the context lookup and null‑check.
 * - Throws a clear error if a component tries to use the
 *   socket outside the provider, catching configuration
 *   mistakes early.
 * - Provides a clean, importable API: `const socket = useSocket()`.
 *
 * Edge Cases Handled:
 * - Component using `useSocket` outside `<SocketProvider>` →
 *   descriptive error thrown immediately.
 * - Provider unmounting and remounting → socket persists
 *   (module‑scoped), listeners are cleaned up and re‑added.
 * - Connection errors → logged to console for debugging.
 *
 * Dependencies:
 * - socket.io-client: `io` factory function
 * - ../config/network: `SOCKET_URL` for the server address
 * -------------------------------------------------------
 */

import React, { createContext, useContext, useEffect } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL } from './config/network';

// ----------------------------------------------------------------------
// Context Creation
// ----------------------------------------------------------------------

/**
 * The Socket.IO context object.
 *
 * Initialised with `null` so `useSocket` can detect when a
 * component tries to consume it without a provider ancestor.
 */
const SocketContext = createContext(null);

// ----------------------------------------------------------------------
// Socket Instance (Module‑Scoped Singleton)
// ----------------------------------------------------------------------

/**
 * The single Socket.IO client instance for the entire app.
 *
 * Created at module scope (not inside a component) so it:
 * - Connects once and persists across page navigations.
 * - Is not recreated when the provider re‑renders.
 * - Survives React Strict Mode double‑mounting in development.
 *
 * Configuration explained:
 * - `transports: ['websocket', 'polling']` — WebSocket first,
 *   long‑polling fallback for restricted networks.
 * - `autoConnect: true` — Connect immediately; no need to
 *   call `.connect()` anywhere.
 * - `reconnection: true` — Automatically reconnect on
 *   disconnection (network loss, server restart).
 * - `reconnectionAttempts: Infinity` — Retry forever.
 *   For a streaming app, this is correct; for a less
 *   critical app, a finite number might be preferred.
 * - `reconnectionDelay: 2000` — Wait 2 seconds between
 *   reconnection attempts (exponential backoff is handled
 *   internally by Socket.IO).
 * - `timeout: 30000` — 30‑second connection timeout before
 *   falling back to polling or giving up.
 * - `withCredentials: true` — Send cookies with the
 *   handshake for server‑side session affinity.
 */
const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 2000,
  timeout: 30000,
  withCredentials: true,
});

// ----------------------------------------------------------------------
// SocketProvider Component
// ----------------------------------------------------------------------

/**
 * SocketProvider
 *
 * Wraps the application (or a subtree) and provides the
 * singleton Socket.IO client via React Context.
 *
 * Why a provider is still needed even though the socket
 * is module‑scoped:
 * - React Context is the standard way to make a dependency
 *   available to the component tree.
 * - `useSocket()` needs a context value to consume.
 * - The provider sets up (and cleans up) global connection
 *   event listeners for logging and debugging.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - The component subtree
 */
export const SocketProvider = ({ children }) => {
  /**
   * Attaches connection lifecycle listeners for debugging.
   *
   * These are purely for development visibility. They log
   * when the socket connects, fails to connect, or drops.
   * In production, these would ideally be replaced with a
   * proper observability pipeline (e.g., Sentry, Datadog).
   *
   * Why `useEffect`:
   * Listeners are attached when the provider mounts and
   * removed when it unmounts. The empty dependency array
   * ensures this only happens once per provider lifecycle.
   */
  useEffect(() => {
    const onConnect = () =>
      console.log('[Socket] Connected:', socket.id);
    const onConnectError = (err) =>
      console.error('[Socket] Connection error:', err.message);
    const onDisconnect = (reason) =>
      console.warn('[Socket] Disconnected:', reason);

    // Subscribe
    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    socket.on('disconnect', onDisconnect);

    // Unsubscribe on unmount
    return () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
};

// ----------------------------------------------------------------------
// Custom Hook: useSocket
// ----------------------------------------------------------------------

/**
 * Returns the singleton Socket.IO client instance.
 *
 * Why a custom hook instead of using `useContext` directly:
 * - Encapsulates the context lookup so components don't
 *   need to import both `SocketContext` and `useContext`.
 * - Provides a clear error message if used outside the
 *   provider, catching configuration mistakes early.
 * - Makes the intent explicit: `useSocket()` is more
 *   readable than `useContext(SocketContext)`.
 *
 * @returns {import('socket.io-client').Socket} The Socket.IO client instance
 * @throws {Error} If called outside a `<SocketProvider>`
 *
 * @example
 * const socket = useSocket();
 * socket.emit('join-stream', streamId);
 * socket.on('new-message', handleMessage);
 */
export const useSocket = () => {
  const context = useContext(SocketContext);

  /**
   * If `context` is null, the component is not wrapped in
   * a `<SocketProvider>`. This is always a bug — throw a
   * descriptive error immediately rather than failing
   * silently later.
   */
  if (!context) {
    throw new Error(
      'useSocket must be used within a <SocketProvider>. ' +
        'Wrap a parent component in <SocketProvider> to fix this.',
    );
  }

  return context;
};