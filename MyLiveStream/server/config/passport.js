/**
 * -------------------------------------------------------
 * File: config/passport.js
 * Purpose:
 * Configures Passport.js for Google OAuth 2.0 authentication.
 * Defines the Google strategy, user serialisation, and
 * deserialisation logic.
 *
 * This module is imported once at server startup (in
 * `server.js`) to register the Google strategy with
 * Passport before any authentication routes are called.
 *
 * High‑Level Workflow:
 * 1. Check that Google OAuth credentials are configured.
 * 2. If configured, register the Google OAuth 2.0 strategy.
 *    - On authentication: find or create the user in MongoDB.
 *    - Link an existing account by email if the Google ID
 *      is new (account merging).
 * 3. If not configured, log a warning — the server will
 *    still start, but Google routes will return 503.
 * 4. Register serialise/deserialise functions for session
 *    support (required by Passport even if using JWT).
 *
 * Design Decisions:
 * - **Account merging by email:** If a user previously
 *   signed up with email/password, and later signs in with
 *   Google using the same email, the accounts are merged
 *   (the Google ID is added to the existing account). This
 *   prevents duplicate accounts for the same person.
 * - **`isVerified: true` for Google users:** Google has
 *   already verified the email address, so we skip the
 *   OTP verification step for OAuth users.
 * - **Fallback name:** If Google doesn't provide a display
 *   name, the email prefix is used (e.g., "user" from
 *   "user@gmail.com").
 * - **Fallback callback URL:** If `GOOGLE_CALLBACK_URL` is
 *   not set, it's constructed from `PORT`. This works for
 *   local development where the callback is always on the
 *   same server.
 * - **`serializeUser` / `deserializeUser`:** Required by
 *   Passport even when using `session: false`. Passport
 *   expects these to be defined regardless.
 *
 * Security Considerations:
 * - The Google OAuth flow uses HTTPS in production. The
 *   client secret is never exposed to the client.
 * - Email addresses are lowercased for consistent matching.
 * - If Google doesn't return an email (rare but possible),
 *   authentication fails gracefully with a clear error.
 *
 * Edge Cases Handled:
 * - **Google credentials missing** → Strategy not registered;
 *   warning logged; Google routes return 503.
 * - **Google account has no email** → Authentication fails
 *   with an explicit error.
 * - **User exists by Google ID** → Logged in directly.
 * - **User exists by email (but no Google ID)** → Accounts
 *   merged; Google ID added to existing account.
 * - **User doesn't exist at all** → New account created.
 * - **Database error during find/create** → Caught and passed
 *   to `done(err)`, which Passport handles.
 *
 * Dependencies:
 * - passport: Authentication middleware
 * - passport-google-oauth20: Google OAuth 2.0 strategy
 * - ../models/User.js: User model for database operations
 * - ./env.js: Environment variables (Google credentials, PORT)
 * -------------------------------------------------------
 */

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User.js';
import {
  GOOGLE_CALLBACK_URL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  PORT,
} from './env.js';

// ----------------------------------------------------------------------
// Google OAuth 2.0 Strategy Registration
// ----------------------------------------------------------------------

/**
 * Register the Google OAuth strategy only if credentials
 * are configured.
 *
 * If credentials are missing, the server starts without
 * Google OAuth support. The auth routes check for this
 * and return 503 (Service Unavailable) for Google endpoints.
 */
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        /**
         * OAuth 2.0 credentials from the Google Cloud Console.
         */
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,

        /**
         * The URL Google redirects to after user authorisation.
         *
         * If `GOOGLE_CALLBACK_URL` is explicitly configured
         * (recommended for production), use that. Otherwise,
         * construct it from the server's port for local
         * development.
         *
         * This must match one of the "Authorised redirect URIs"
         * in the Google Cloud Console.
         */
       callbackURL:
  GOOGLE_CALLBACK_URL ||
  `https://livepulse-xvp1.onrender.com/api/auth/google/callback`,
      },

      /**
       * Verify callback — called after Google authenticates
       * the user and returns their profile.
       *
       * This is where we find or create the corresponding
       * user in our database.
       *
       * @param {string} accessToken - Google access token (unused)
       * @param {string} refreshToken - Google refresh token (unused)
       * @param {object} profile - The user's Google profile
       * @param {function} done - Passport callback: `done(err, user)`
       */
      async (accessToken, refreshToken, profile, done) => {
        try {
          /**
           * Extract and normalise the email address.
           *
           * `profile.emails` is an array of email objects
           * from Google. We use the primary one (index 0).
           * The email is lowercased for case‑insensitive matching.
           */
          const email = profile.emails?.[0]?.value?.toLowerCase();

          // Google should always return an email, but guard
          // against the edge case where it doesn't.
          if (!email) {
            return done(
              new Error('Google account did not return an email'),
              null,
            );
          }

          /**
           * Step 1: Look up the user by their Google ID.
           *
           * This handles returning users who have previously
           * signed in with Google.
           */
          let user = await User.findOne({ googleId: profile.id });

          // If not found by Google ID, check by email for
          // account merging.
          if (!user) {
            /**
             * Step 2: Look up by email.
             *
             * This handles the case where the user previously
             * signed up with email/password and is now signing
             * in with Google for the first time. We merge the
             * accounts by adding the Google ID to the existing
             * account.
             */
            user = await User.findOne({ email });

            if (user) {
              /**
               * Account merging: add the Google ID to the
               * existing account and mark as verified.
               *
               * This is safe because Google has verified the
               * email address, so we trust that this is the
               * same person.
               */
              user.googleId = profile.id;
              user.isVerified = true;
              await user.save();
            } else {
              /**
               * Step 3: Create a brand new account.
               *
               * The user doesn't exist by Google ID or email.
               * Create a new account with the Google profile
               * data. No password is set — this user will
               * always authenticate via Google.
               *
               * The display name defaults to the email prefix
               * (e.g., "user" from "user@gmail.com") if Google
               * doesn't provide one.
               */
              user = await User.create({
                googleId: profile.id,
                email,
                name: profile.displayName || email.split('@')[0],
                isVerified: true, // Google already verified the email
              });
            }
          }

          // Authentication successful — pass the user to Passport.
          return done(null, user);
        } catch (err) {
          /**
           * Log the error for debugging, then pass it to
           * Passport. Passport will handle sending an error
           * response to the client.
           */
          console.error('[Google Auth] Error:', err.message);
          return done(err, null);
        }
      },
    ),
  );
} else {
  /**
   * Google OAuth is not configured.
   *
   * Log a warning so the developer knows Google sign‑in
   * will not work. The server continues to run — Google
   * routes will return 503.
   */
  console.warn(
    '[Google Auth] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not configured',
  );
}

// ----------------------------------------------------------------------
// Serialisation / Deserialisation
// ----------------------------------------------------------------------

/**
 * Serialises the user for the session.
 *
 * Passport requires `serializeUser` and `deserializeUser`
 * to be defined, even when using `session: false` in the
 * authentication call. These are called if you ever use
 * Passport's session support.
 *
 * With `session: false`, these are effectively unused, but
 * defining them prevents Passport from throwing at startup.
 *
 * @param {object} user - The user document
 * @param {function} done - Passport callback
 */
passport.serializeUser((user, done) => done(null, user.id));

/**
 * Deserialises the user from the session.
 *
 * Fetches the full user document from the database using
 * the ID stored in the session.
 *
 * @param {string} id - The user's MongoDB ID
 * @param {function} done - Passport callback
 */
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});