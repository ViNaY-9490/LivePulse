/**
 * -------------------------------------------------------
 * File: config/db.js
 * Purpose:
 * Establishes and manages the connection to MongoDB using
 * Mongoose. This module is called once at server startup
 * and handles connection errors by terminating the process
 * — there is no point running a server without its database.
 *
 * High‑Level Workflow:
 * 1. Validates that `MONGO_URI` is configured.
 * 2. Configures Mongoose strict mode for query filtering.
 * 3. Attempts to connect to MongoDB.
 * 4. On success: logs confirmation and the server continues.
 * 5. On failure: logs the error and exits the process.
 *
 * Design Decisions:
 * - **`strictQuery: false`:** Prepares for Mongoose 7+ where
 *   strict query mode defaults to `true`. Setting it
 *   explicitly avoids deprecation warnings and ensures
 *   queries that include unknown fields are silently
 *   stripped rather than throwing errors. This is the
 *   more forgiving setting and matches Mongoose 6 defaults.
 * - **Process exit on failure:** If the database is
 *   unreachable, the server cannot function (no user
 *   storage, no session persistence). Exiting immediately
 *   is better than serving requests that will all fail.
 *   Container orchestration (Docker, Kubernetes) will
 *   restart the process automatically.
 * - **No retry logic built‑in:** Mongoose's default
 *   connection options include a 30‑second server selection
 *   timeout. For more sophisticated retry behaviour,
 *   configure `serverSelectionTimeoutMS` and `heartbeatFrequencyMS`
 *   in the `connect()` options, or rely on the orchestrator
 *   to restart the container.
 *
 * Edge Cases Handled:
 * - `MONGO_URI` is missing or empty → throws immediately
 *   with a clear error message before attempting connection.
 * - Connection timeout → caught by the `catch` block.
 * - Authentication failure → caught by the `catch` block.
 * - Network unreachable → caught by the `catch` block.
 *
 * Dependencies:
 * - mongoose: MongoDB ODM
 * - ../config/env.js: `MONGO_URI` environment variable
 * -------------------------------------------------------
 */

import mongoose from 'mongoose';
import { MONGO_URI } from './env.js';

// ----------------------------------------------------------------------
// Database Connection
// ----------------------------------------------------------------------

/**
 * Connects to MongoDB using the configured URI.
 *
 * This function should be called once at application startup,
 * before the HTTP server begins listening. It is intentionally
 * not called during module import — the caller decides when
 * to initiate the connection.
 *
 * @async
 * @returns {Promise<void>} Resolves when connected; never rejects
 *   because errors are handled internally and the process exits.
 *
 * @example
 * import connectDB from './config/db.js';
 *
 * // At the top of server.js, before creating the Express app:
 * await connectDB();
 */
const connectDB = async () => {
  try {
    /**
     * Guard: ensure the connection string is configured.
     *
     * This fails fast with a clear message rather than
     * letting Mongoose throw a cryptic "URI must be a string"
     * error.
     */
    if (!MONGO_URI) {
      throw new Error('MONGO_URI is not configured');
    }

    /**
     * Configure Mongoose strict query mode.
     *
     * `strictQuery: false` means Mongoose will strip unknown
     * fields from query filters instead of throwing an error.
     * This matches the default behaviour in Mongoose 6 and
     * prevents breaking changes when upgrading to Mongoose 7+.
     *
     * Why `false` and not `true`:
     * - More forgiving for development and rapid iteration.
     * - Prevents queries from breaking when the client sends
     *   extra fields that aren't in the schema.
     * - If you prefer strict validation, set to `true` — but
     *   ensure all query filters only include schema fields.
     */
    mongoose.set('strictQuery', false);

    /**
     * Connect to MongoDB.
     *
     * Default connection options:
     * - `serverSelectionTimeoutMS: 30000` — Waits up to 30
     *   seconds to find a MongoDB server before timing out.
     * - `heartbeatFrequencyMS: 10000` — Sends a heartbeat
     *   every 10 seconds to keep the connection alive.
     *
     * These defaults are acceptable for most deployments.
     * To customise, pass an options object as the second
     * argument:
     * ```
     * await mongoose.connect(MONGO_URI, {
     *   serverSelectionTimeoutMS: 5000, // Fail faster
     *   maxPoolSize: 10,                // Connection pool size
     * });
     * ```
     */
    await mongoose.connect(MONGO_URI);

    /**
     * Log success.
     *
     * In production, consider replacing `console.log` with
     * a structured logger that includes a timestamp and
     * the database name (available via `mongoose.connection.name`).
     */
    console.log('[DB] Connected');
  } catch (err) {
    /**
     * Log the error and exit.
     *
     * Why `process.exit(1)`:
     * - The server is useless without a database.
     * - Exiting immediately is cleaner than serving requests
     *   that will all return 500 errors.
     * - Container orchestration (Docker, K8s) will detect the
     *   crash and restart the container, potentially with a
     *   backoff strategy.
     *
     * Why `err.message` and not the full error object:
     * - The message contains the actionable information
     *   (e.g., "getaddrinfo ENOTFOUND mongodb.example.com").
     * - The full stack trace is usually noise for a connection
     *   failure. If full debugging is needed, log `err` instead.
     */
    console.error('[DB] Connection error:', err.message);
    process.exit(1);
  }
};

// ----------------------------------------------------------------------
// Export
// ----------------------------------------------------------------------

export default connectDB;