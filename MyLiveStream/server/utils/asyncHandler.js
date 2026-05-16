/**
 * -------------------------------------------------------
 * File: utils/asyncHandler.js
 * Purpose:
 * Wraps asynchronous Express route handlers and middleware
 * so that any unhandled promise rejections are automatically
 * forwarded to Express's error‑handling middleware.
 *
 * This eliminates the need for repetitive try/catch blocks
 * in every async controller function. Instead of:
 *
 * ```
 * const login = async (req, res, next) => {
 *   try {
 *     // ... async logic ...
 *   } catch (err) {
 *     next(err);
 *   }
 * };
 * ```
 *
 * You write:
 *
 * ```
 * const login = asyncHandler(async (req, res, next) => {
 *   // ... async logic — errors are caught automatically ...
 * });
 * ```
 *
 * How It Works:
 * 1. Takes an async function `fn` as its argument.
 * 2. Returns a new Express middleware function.
 * 3. When the returned function is called, it executes `fn`
 *    and wraps its return value in `Promise.resolve()`.
 * 4. If `fn` throws (or returns a rejected promise), the
 *    `.catch(next)` passes the error to Express's error
 *    handler via `next(err)`.
 *
 * Why `Promise.resolve()` instead of just calling `fn()`:
 * - `fn` might not be async (though it usually is). Wrapping
 *   in `Promise.resolve()` ensures any thrown synchronous
 *   errors are also caught and forwarded.
 * - This makes the wrapper safe for both synchronous and
 *   asynchronous route handlers.
 *
 * Why a separate utility:
 * This pattern is needed in every controller file. Extracting
 * it to a reusable utility keeps controllers clean and
 * consistent. It's a well‑known Express pattern popularised
 * by the `express-async-errors` package, but implemented
 * here without an external dependency.
 *
 * @param {Function} fn - An async (or sync) Express route
 *   handler with signature `(req, res, next)`.
 * @returns {Function} A wrapped handler that catches and
 *   forwards errors to `next()`.
 *
 * @example
 * // Without asyncHandler:
 * app.get('/user', async (req, res, next) => {
 *   try {
 *     const user = await getUser();
 *     res.json(user);
 *   } catch (err) {
 *     next(err);
 *   }
 * });
 *
 * // With asyncHandler:
 * app.get('/user', asyncHandler(async (req, res) => {
 *   const user = await getUser();
 *   res.json(user);
 * }));
 *
 * Dependencies:
 * - None (pure JavaScript utility)
 * -------------------------------------------------------
 */

/**
 * Wraps an Express route handler to catch unhandled promise
 * rejections and forward them to the error‑handling middleware.
 *
 * @param {Function} fn - The async route handler to wrap
 * @returns {Function} A new middleware function with error handling
 */
const asyncHandler = (fn) => (req, res, next) => {
  /**
   * Execute the wrapped function and catch any errors.
   *
   * `Promise.resolve()` ensures that:
   * - If `fn` returns a promise (async function), it's used as‑is.
   * - If `fn` throws synchronously, the throw is converted to
   *   a rejected promise.
   * - If `fn` returns a non‑promise value, it's wrapped in a
   *   resolved promise (though this is rare for route handlers).
   *
   * `.catch(next)` passes any error to Express's next error
   * handler, which is typically the global error handler
   * middleware (defined in `middleware/globalMiddleware.js`).
   */
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;