/**
 * -------------------------------------------------------
 * File: server.js
 * Purpose:
 * The main entry point for the LivePulse streaming server.
 * Bootstraps the Express HTTP server, Socket.IO signalling
 * server, and raw WebSocket media server — all on a single
 * port — then listens for incoming connections.
 *
 * This file is the orchestration layer. It wires together
 * every subsystem: database, authentication, CORS, security
 * headers, rate limiting, Passport OAuth, REST API routes,
 * Socket.IO signalling, and WebSocket media streaming.
 *
 * High‑Level Architecture:
 * 1. Connect to MongoDB via `connectDB()`.
 * 2. Create an Express app with security, logging, and
 *    parsing middleware.
 * 3. Mount authentication routes at `/api/auth`.
 * 4. Create an HTTP server from the Express app.
 * 5. Attach a Socket.IO server to the HTTP server for
 *    signalling (chat, reactions, viewer counts).
 * 6. Attach a WebSocket server to the HTTP server for
 *    raw media streaming (broadcaster → viewers).
 *    The `upgrade` event routes `/stream` requests to the
 *    WebSocket server; all other requests go to Express.
 * 7. Start listening on the configured port.
 *
 * Why a single port:
 * - Simplifies deployment (one port to expose).
 * - Avoids cross‑origin issues between HTTP and WebSocket.
 * - The `upgrade` event demultiplexes between Express,
 *   Socket.IO, and the raw WebSocket server.
 *
 * Design Decisions:
 * - **Helmet with `contentSecurityPolicy: false`:** CSP is
 *   disabled because the client is a separate Vite app.
 *   CSP headers would block the client's scripts. If the
 *   server also served the client build, CSP should be
 *   configured appropriately.
 * - **`CORS_ORIGINS` from environment:** Allows additional
 *   origins to be whitelisted via env vars (e.g., preview
 *   deployments, staging).
 * - **Body parser limit (1 MB):** Prevents large payload
 *   attacks while accommodating reasonable request sizes.
 * - **Morgan logging:** Uses `'dev'` format in development
 *   (coloured, concise) and `'combined'` in production
 *   (Apache‑style, includes response time and size).
 * - **WebSocket `noServer: true`:** The raw WebSocket server
 *   doesn't create its own HTTP server. Instead, it hooks
 *   into the existing HTTP server's `upgrade` event. This
 *   allows all three protocols (HTTP, Socket.IO, WS) to
 *   share a single port.
 *
 * Security:
 * - CORS is strictly whitelisted — only known origins.
 * - Helmet sets standard security headers (X‑Frame‑Options,
 *   X‑Content‑Type‑Options, etc.).
 * - Rate limiting is applied globally at `/api/`.
 * - WebSocket connections are validated: origin checked,
 *   `streamId` sanitised, duplicate broadcaster rejected.
 *
 * Edge Cases Handled:
 * - **Unknown CORS origin** → rejected with a logged warning.
 * - **WebSocket upgrade to non‑`/stream` path** → ignored.
 * - **Broadcaster for an already‑active stream** → rejected
 *   with close code 1008 (Policy Violation).
 * - **Viewer for a non‑existent stream** → WebSocket closed.
 * - **Missing `streamId` in WebSocket query** → closed.
 * - **Stale `initSegment` (broadcaster reconnects)** →
 *   previous session is closed; new `initSegment` is captured.
 *
 * Dependencies:
 * - express: HTTP framework
 * - http: Node.js HTTP server
 * - socket.io: Signalling server
 * - ws: Raw WebSocket server for media streaming
 * - cors: Cross‑Origin Resource Sharing
 * - passport: Google OAuth strategy
 * - morgan: HTTP request logger
 * - helmet: Security headers
 * - ./config/env.js: Environment variables
 * - ./config/db.js: MongoDB connection
 * - ./config/passport.js: Passport Google strategy
 * - ./middleware/globalMiddleware.js: Logger + error handler
 * - ./middleware/rateLimiter.js: Rate limiter
 * - ./routes/authRoutes.js: Auth API routes
 * - ./sockets/streamSocket.js: Socket.IO signalling handler
 * - ./state/streamState.js: In‑memory stream session store
 * -------------------------------------------------------
 */

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import passport from 'passport';
import url from 'url';
import { WebSocketServer } from 'ws';
import morgan from 'morgan';
import helmet from 'helmet';

import { PORT, CLIENT_URL, CORS_ORIGINS, NODE_ENV } from './config/env.js';
import connectDB from './config/db.js';
import './config/passport.js';

import { logger, errorHandler } from './middleware/globalMiddleware.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import authRoutes from './routes/authRoutes.js';
import streamSocketHandler from './sockets/streamSocket.js';
import streamSessions, {
  closeStreamSession,
  ensureStreamSession,
} from './state/streamState.js';

// ----------------------------------------------------------------------
// Database Connection
// ----------------------------------------------------------------------

/**
 * Connect to MongoDB before starting the server.
 *
 * If the connection fails, the process exits — there's no
 * point running a server that can't access its database.
 * The `connectDB` function handles the error and exit.
 */
connectDB();

// ----------------------------------------------------------------------
// Express Application Setup
// ----------------------------------------------------------------------

const app = express();


app.set('trust proxy', 1);
// ----------------------------------------------------------------------
// HTTP Server (shared by Express, Socket.IO, and WebSocket)
// ----------------------------------------------------------------------

/**
 * A single HTTP server instance.
 *
 * Express handles standard HTTP requests.
 * Socket.IO attaches to this server for signalling.
 * The raw WebSocket server hooks into the `upgrade` event
 * on this server for media streaming.
 */
const server = http.createServer(app);

// ----------------------------------------------------------------------
// CORS Configuration
// ----------------------------------------------------------------------

/**
 * Allowed origins for CORS.
 *
 * Includes:
 * - The configured `CLIENT_URL` (from env).
 * - Local development URLs (Vite default ports: 5173, 5174).
 * - Any additional origins specified in `CORS_ORIGINS`.
 *
 * `.filter(Boolean)` removes any `undefined` or empty
 * entries from the array (e.g., if `CLIENT_URL` is not set).
 */
const allowedOrigins = [
  CLIENT_URL,
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://localhost:5174',
  'https://the-live-pulse.vercel.app',
  'https://thelivepulse.netlify.app',
  'http://127.0.0.1:5174',
  ...CORS_ORIGINS,
].filter(Boolean);

/**
 * Checks whether an origin is in the allowed list.
 *
 * `!origin` handles non‑browser requests (e.g., Postman,
 * server‑to‑server calls) that don't send an Origin header.
 * These are allowed through.
 *
 * @param {string|null} origin - The request's Origin header
 * @returns {boolean} True if the origin is allowed
 */
const isAllowedOrigin = (origin) =>
  !origin || allowedOrigins.includes(origin);

/**
 * CORS options for Express, Socket.IO, and WebSocket.
 *
 * - `origin`: Dynamic callback that checks the allowlist.
 * - `credentials: true`: Allows cookies and Authorization
 *   headers to be sent cross‑origin.
 * - `methods`: Whitelist of allowed HTTP methods.
 * - `allowedHeaders`: Headers the client is allowed to send.
 */
const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    // Log blocked origins for monitoring and debugging
    console.warn('[CORS] Blocked origin:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// ----------------------------------------------------------------------
// Express Middleware
// ----------------------------------------------------------------------

/**
 * Helmet: Sets various HTTP security headers.
 *
 * `contentSecurityPolicy: false` disables CSP because the
 * client is a separate application. If this server also
 * served the client build, CSP should be enabled and
 * configured to allow the client's scripts and styles.
 */
app.use(helmet({ contentSecurityPolicy: false }));

/** CORS: Enforces the origin allowlist defined above. */
app.use(cors(corsOptions));

/**
 * Body parser: Parses JSON request bodies.
 *
 * `limit: '1mb'` prevents memory exhaustion from
 * excessively large payloads.
 */
app.use(express.json({ limit: '1mb' }));

/**
 * Morgan: HTTP request logger.
 *
 * - `'dev'` in development: concise, coloured output.
 * - `'combined'` in production: standard Apache format
 *   with response time, size, and referrer.
 */
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

/** Custom logger: Logs method, URL, and timestamp. */
app.use(logger);

/** Passport: Initialises the Google OAuth strategy. */
app.use(passport.initialize());

/** Global rate limiter: Applies to all `/api/` routes. */
app.use('/api/', apiLimiter);

// ----------------------------------------------------------------------
// Health Check
// ----------------------------------------------------------------------

/**
 * GET /ping
 *
 * Simple health check endpoint. Used by load balancers and
 * monitoring tools to verify the server is running.
 */
app.get('/ping', (req, res) => res.json({ status: 'ok' }));

// ----------------------------------------------------------------------
// API Routes
// ----------------------------------------------------------------------

/**
 * Authentication routes mounted at `/api/auth`.
 *
 * All routes in this router inherit:
 * - The global `/api/` rate limiter.
 * - Route‑specific `authLimiter` where applied.
 */
app.use('/api/auth', authRoutes);

// ----------------------------------------------------------------------
// Socket.IO Server (Signalling)
// ----------------------------------------------------------------------

/**
 * Socket.IO server for real‑time signalling.
 *
 * Shares the same HTTP server and CORS configuration.
 *
 * Configuration:
 * - `transports: ['websocket', 'polling']`: WebSocket first,
 *   long‑polling fallback.
 * - `pingTimeout: 60000`: 60 seconds without a pong before
 *   the connection is considered lost.
 * - `pingInterval: 25000`: Send a ping every 25 seconds to
 *   keep the connection alive and detect drops.
 */
const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

/** Register all Socket.IO event handlers (chat, streams, etc.) */
streamSocketHandler(io);

// ----------------------------------------------------------------------
// Raw WebSocket Server (Media Streaming)
// ----------------------------------------------------------------------

/**
 * WebSocket server for raw media data streaming.
 *
 * `noServer: true` means this server does not create its
 * own HTTP server. Instead, it hooks into the existing HTTP
 * server's `upgrade` event. This allows HTTP, Socket.IO,
 * and raw WebSocket to all share port `PORT`.
 *
 * `clientTracking: true` enables `wss.clients` for
 * monitoring connected viewers.
 */
const wss = new WebSocketServer({
  noServer: true,
  clientTracking: true,
});

// ----------------------------------------------------------------------
// HTTP Upgrade Handler (Routes WebSocket connections)
// ----------------------------------------------------------------------

/**
 * Handles HTTP Upgrade requests.
 *
 * This is the demultiplexer: when a client requests a
 * protocol upgrade to WebSocket, this handler inspects
 * the pathname and decides which server to route to.
 *
 * - `/stream`        → Raw WebSocket server (media data).
 * - `/socket.io/*`   → Handled automatically by Socket.IO.
 * - Everything else   → Handled by Express.
 */
server.on('upgrade', (request, socket, head) => {
  const { pathname } = url.parse(request.url, true);

  // Only the raw media WebSocket uses the `/stream` path.
  // Socket.IO handles its own upgrade internally.
  if (pathname !== '/stream') {
    return;
  }

  // Enforce CORS for WebSocket upgrades.
  // Browsers don't send CORS preflight for WebSockets, but
  // the Origin header is still present and should be checked.
  if (!isAllowedOrigin(request.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  // Upgrade the connection and pass it to the WebSocket server.
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// ----------------------------------------------------------------------
// WebSocket Connection Handler
// ----------------------------------------------------------------------

/**
 * Handles new raw WebSocket connections.
 *
 * Two connection types are supported:
 * - `broadcaster`: Sends media data; received chunks are
 *   relayed to all viewers in the same stream room.
 * - `viewer`: Receives media data; first receives the
 *   stored `initSegment`, then all subsequent chunks.
 */
wss.on('connection', (ws, req) => {
  // Parse query parameters from the WebSocket URL
  const { query } = url.parse(req.url, true);
  const type = typeof query.type === 'string' ? query.type : '';
  const streamId =
    typeof query.streamId === 'string' ? query.streamId.trim() : '';

  // Reject connections without a stream ID
  if (!streamId) {
    ws.close();
    return;
  }

  // ----------------------------------------------------------------
  // Broadcaster Connection
  // ----------------------------------------------------------------

  if (type === 'broadcaster') {
    const existingSession = streamSessions[streamId];

    // Reject if this stream already has an active broadcaster.
    // `readyState === 1` means the WebSocket is in the OPEN state.
    if (existingSession?.broadcaster?.readyState === 1) {
      ws.close(1008, 'Stream already active');
      return;
    }

    console.log(`[WS] Broadcaster connected: ${streamId}`);

    // Create or update the session with this broadcaster WebSocket
    ensureStreamSession(streamId, { broadcaster: ws });

    /**
     * Relay media data from the broadcaster to all viewers.
     *
     * The first chunk received is saved as the `initSegment`.
     * This is the WebM header + first cluster, required by
     * MSE for initialisation. New viewers receive this segment
     * immediately upon connecting so they can start playback.
     *
     * All subsequent chunks are relayed directly to every
     * connected viewer.
     */
    ws.on('message', (data) => {
      const session = streamSessions[streamId];
      if (!session) return;

      // Capture the first chunk as the initialisation segment
      if (!session.initSegment) {
        console.log(`[WS] Header captured for ${streamId}`);
        session.initSegment = data;
      }

      // Relay the chunk to every connected viewer
      session.viewers.forEach((viewer) => {
        if (viewer.readyState === 1) {
          viewer.send(data);
        }
      });
    });

    /**
     * Handle broadcaster disconnection.
     *
     * Notifies all viewers that the stream has ended and
     * cleans up the session. `closeBroadcaster: false` is
     * passed because the WebSocket is already closing — we
     * don't need to call `.close()` again.
     */
    ws.on('close', () => {
      const session = streamSessions[streamId];
      if (session?.broadcaster !== ws) return;

      console.log(`[WS] Broadcaster disconnected: ${streamId}`);
      io.to(streamId).emit('stream-ended', {
        streamId,
        reason: 'broadcaster-disconnected',
      });
      closeStreamSession(streamId, { closeBroadcaster: false });
    });

    return;
  }

  // ----------------------------------------------------------------
  // Viewer Connection
  // ----------------------------------------------------------------

  if (type === 'viewer') {
    console.log(`[WS] Viewer connecting to: ${streamId}`);
    const session = streamSessions[streamId];

    // Reject if the stream doesn't exist
    if (!session) {
      console.log(
        `[WS] Session ${streamId} not found for viewer. Closing.`,
      );
      ws.close();
      return;
    }

    // Add this viewer to the session's viewer set
    session.viewers.add(ws);

    /**
     * Send the initialisation segment immediately.
     *
     * This is the WebM header needed by MSE to initialise
     * the SourceBuffer. Without it, the viewer cannot start
     * playback even if subsequent chunks arrive.
     */
    if (session.initSegment) {
      ws.send(session.initSegment);
    }

    /**
     * Handle viewer disconnection.
     *
     * Removes the viewer from the session's viewer set so
     * we don't try to send data to a closed socket.
     */
    ws.on('close', () => {
      session.viewers.delete(ws);
    });

    return;
  }

  // ----------------------------------------------------------------
  // Unknown Connection Type
  // ----------------------------------------------------------------

  // If the type is neither 'broadcaster' nor 'viewer', close.
  ws.close();
});

// ----------------------------------------------------------------------
// Error Handler (must be last middleware)
// ----------------------------------------------------------------------

app.use(errorHandler);

// ----------------------------------------------------------------------
// Start Server
// ----------------------------------------------------------------------

/**
 * Start listening on the configured port.
 *
 * Binds to `0.0.0.0` to accept connections from any network
 * interface (localhost, LAN, public IP). In production behind
 * a reverse proxy, this is standard practice.
 */
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  MODULAR SERVER RUNNING
  ----------------------------
  Port:    ${PORT}
  Address: http://127.0.0.1:${PORT}
  Mode:    Distributed Files (ESM)
  ----------------------------
  `);
});