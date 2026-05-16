/**
 * -------------------------------------------------------
 * File: models/User.js
 * Purpose:
 * Defines the Mongoose User model — the database schema
 * and business logic for user accounts.
 *
 * This model is the single source of truth for user data
 * structure, validation, and password/security‑answer
 * hashing. Every authentication operation (signup, login,
 * password reset, OTP verification) reads from or writes
 * to this model.
 *
 * High‑Level Schema:
 * - `name`             — Display name (required, trimmed).
 * - `email`            — Unique email (lowercased, trimmed).
 * - `password`         — Bcrypt‑hashed password.
 * - `googleId`         — Google OAuth identifier (for federated login).
 * - `isVerified`       — Whether the user has verified their email.
 * - `otp` / `otpExpires` — One‑time password for 2FA and verification.
 * - `securityQuestion` — User‑chosen security question.
 * - `securityAnswer`   — Bcrypt‑hashed answer (case‑insensitive).
 * - `refreshTokens`    — Array of active refresh tokens for rotation.
 * - `streamKey`        — Unique, sparse key for live streaming.
 * - `timestamps`       — Automatic `createdAt` and `updatedAt`.
 *
 * Design Decisions:
 * - **Pre‑save hook for hashing:** Passwords and security
 *   answers are automatically hashed before persisting.
 *   This ensures no plaintext sensitive data ever reaches
 *   the database, even if a developer forgets to hash
 *   manually.
 * - **`bcrypt` with 12 salt rounds:** 12 rounds provides
 *   a good balance between security and performance (≈250ms
 *   on modern hardware). Increase to 14+ for higher security
 *   requirements.
 * - **`HASH_PREFIX` guard (`$2`):** Detects whether the
 *   security answer is already hashed before re‑hashing.
 *   bcrypt hashes always start with `$2a$`, `$2b$`, or
 *   `$2y$`. This prevents double‑hashing if `save()` is
 *   called multiple times.
 * - **`streamKey` is `sparse: true`:** Only users who
 *   become streamers have this field. The `sparse` index
 *   allows multiple `null` values (users without a key)
 *   while enforcing uniqueness for those who have one.
 * - **`refreshTokens` as an array of subdocuments:** Allows
 *   storing multiple active refresh tokens per user (one
 *   per device/session) and supports token rotation.
 *
 * Security Considerations:
 * - Passwords are never stored in plaintext.
 * - Security answers are case‑insensitive (trimmed and
 *   lowercased before hashing) to reduce user friction
 *   while maintaining security.
 * - The `HASH_PREFIX` check supports both hashed and
 *   legacy plaintext answers (for data migration).
 * - `comparePassword` returns `false` (not an error) if
 *   the user has no password (e.g., Google OAuth users).
 *
 * Edge Cases Handled:
 * - **Google OAuth users have no password** → `password`
 *   is optional; `comparePassword` returns `false` safely.
 * - **Security answer not yet hashed** → `compareSecurityAnswer`
 *   supports both plaintext comparison (legacy) and bcrypt
 *   comparison (current).
 * - **Double‑save prevention** → The `HASH_PREFIX` guard
 *   prevents re‑hashing an already‑hashed answer.
 * - **Empty string security answer** → The pre‑save hook
 *   checks for truthiness before hashing.
 *
 * Dependencies:
 * - mongoose: ODM for MongoDB
 * - bcryptjs: Password and answer hashing
 * -------------------------------------------------------
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// ----------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------

/**
 * Bcrypt hash prefix — all bcrypt hashes start with `$2`.
 *
 * Used to detect whether a security answer has already been
 * hashed, preventing double‑hashing on subsequent saves.
 *
 * Bcrypt variants:
 * - `$2a$` — Original algorithm.
 * - `$2b$` — Fixed handling of null bytes (Node.js default).
 * - `$2y$` — Backward‑compatible alias used by some PHP implementations.
 * All three start with `$2`, so a single‑character check is sufficient.
 */
const HASH_PREFIX = '$2';

// ----------------------------------------------------------------------
// User Schema Definition
// ----------------------------------------------------------------------

/**
 * Mongoose schema for the User collection.
 *
 * Why each field is configured as it is:
 * - `trim: true` on string fields removes leading/trailing
 *   whitespace, preventing accidental duplicate accounts
 *   with invisible characters.
 * - `lowercase: true` on email ensures case‑insensitive
 *   uniqueness (user@example.com === USER@EXAMPLE.COM).
 * - `unique: true` on email creates a MongoDB unique index,
 *   enforcing uniqueness at the database level.
 * - `sparse: true` on streamKey allows multiple documents
 *   to have no stream key (null) while ensuring uniqueness
 *   for those that do.
 * - `timestamps: true` automatically adds `createdAt` and
 *   `updatedAt` fields managed by Mongoose.
 */
const userSchema = new mongoose.Schema(
  {
    /** User's display name (required, trimmed to 80 chars by the controller) */
    name: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * User's email address.
     * Unique index enforces one account per email at the database level.
     */
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    /**
     * Bcrypt‑hashed password.
     * Optional because Google OAuth users authenticate without a password.
     * Hashed automatically in the pre‑save hook.
     */
    password: {
      type: String,
    },

    /**
     * Google OAuth identifier.
     * Set when a user signs up or logs in via Google.
     * Used to link the Google account to this user record.
     */
    googleId: {
      type: String,
    },

    /**
     * Whether the user has verified their email address.
     * Set to `true` after successful OTP verification during signup.
     * Unverified accounts cannot log in.
     */
    isVerified: {
      type: Boolean,
      default: false,
    },

    /**
     * One‑time password for email verification and 2FA login.
     * Stored as plaintext because it's short‑lived (10 minutes).
     * Cleared after successful verification.
     */
    otp: {
      type: String,
    },

    /**
     * Expiry timestamp for the OTP.
     * After this time, the OTP is considered invalid.
     */
    otpExpires: {
      type: Date,
    },

    /**
     * Security question for account recovery.
     * Displayed to the user when they request a password reset.
     */
    securityQuestion: {
      type: String,
      trim: true,
    },

    /**
     * Bcrypt‑hashed security answer.
     * Trimmed and lowercased before hashing for case‑insensitive comparison.
     * Hashed automatically in the pre‑save hook.
     */
    securityAnswer: {
      type: String,
    },

    /**
     * Array of active refresh tokens.
     * Each token is stored as `{ token: '<jwt>' }`.
     *
     * Why an array:
     * A user can be logged in on multiple devices. Each device
     * has its own refresh token. When a token is rotated, the
     * old one is removed and the new one is added.
     */
    refreshTokens: [
      {
        token: String,
      },
    ],

    /**
     * Unique stream key for live broadcasting.
     *
     * `sparse: true` means only documents with a non‑null
     * streamKey are included in the unique index. This allows
     * multiple users to not have a stream key while enforcing
     * uniqueness for those who do.
     */
    streamKey: {
      type: String,
      unique: true,
      sparse: true,
    },
  },
  {
    /**
     * Automatically add `createdAt` and `updatedAt` fields.
     * These are managed by Mongoose and updated automatically
     * on `save()`.
     */
    timestamps: true,
  },
);

// ----------------------------------------------------------------------
// Pre‑Save Hook — Automatic Hashing
// ----------------------------------------------------------------------

/**
 * Mongoose pre‑save middleware.
 *
 * Runs before every `save()` call (both `user.save()` and
 * `User.create()`). Handles automatic hashing of sensitive
 * fields so that controllers don't need to hash manually.
 *
 * Why a pre‑save hook instead of manual hashing in the controller:
 * - Centralises hashing logic — one place to maintain.
 * - Prevents human error — impossible to forget to hash.
 * - Works with both `save()` and `create()`.
 *
 * @param {function} next - Mongoose next callback
 */
userSchema.pre('save', async function preSave(next) {
  /**
   * Hash the password if it has been modified.
   *
   * `isModified('password')` returns true for:
   * - New documents (first save).
   * - Existing documents where the password field was changed.
   *
   * It returns false for:
   * - Existing documents where other fields changed.
   *
   * This prevents re‑hashing an already‑hashed password on
   * every save (e.g., when updating `isVerified`).
   */
  if (this.isModified('password') && this.password) {
    /**
     * 12 salt rounds.
     *
     * Why 12:
     * - 10 rounds ≈ 100ms (fast, less secure).
     * - 12 rounds ≈ 250ms (good balance for UX + security).
     * - 14 rounds ≈ 1s (more secure, noticeable delay).
     *
     * Adjust based on your security requirements and server
     * hardware. Each increment doubles the hashing time.
     */
    this.password = await bcrypt.hash(this.password, 12);
  }

  /**
   * Hash the security answer if it has been modified and
   * isn't already hashed.
   *
   * The `HASH_PREFIX` check prevents double‑hashing:
   * - On first save: answer is plaintext → hashed.
   * - On subsequent saves: answer starts with `$2` → skipped.
   *
   * The answer is trimmed and lowercased before hashing to
   * enable case‑insensitive comparison during verification.
   */
  if (
    this.isModified('securityAnswer') &&
    this.securityAnswer &&
    !this.securityAnswer.startsWith(HASH_PREFIX)
  ) {
    this.securityAnswer = await bcrypt.hash(
      this.securityAnswer.trim().toLowerCase(),
      12,
    );
  }

  next();
});

// ----------------------------------------------------------------------
// Instance Methods
// ----------------------------------------------------------------------

/**
 * Compares a candidate password against the stored hash.
 *
 * Why a method on the schema:
 * - Keeps the hashing logic encapsulated within the model.
 * - Controllers can call `user.comparePassword(input)` without
 *   importing bcrypt directly.
 *
 * @param {string} candidatePassword - The plaintext password to check
 * @returns {Promise<boolean>} True if the password matches
 */
userSchema.methods.comparePassword =
  async function comparePassword(candidatePassword) {
    // If the user has no password (Google OAuth user), always
    // return false — they should use Google to log in.
    if (!this.password) return false;

    return bcrypt.compare(candidatePassword, this.password);
  };

/**
 * Compares a candidate security answer against the stored hash.
 *
 * Supports both:
 * - Hashed answers (current): compared via bcrypt.
 * - Plaintext answers (legacy): compared as‑is (case‑insensitive).
 *
 * Why support both:
 * During a migration from plaintext to hashed answers, some
 * users may still have plaintext answers in the database.
 * This method handles both transparently.
 *
 * @param {string} candidateAnswer - The plaintext answer to check
 * @returns {Promise<boolean>} True if the answer matches
 */
userSchema.methods.compareSecurityAnswer =
  async function compareSecurityAnswer(candidateAnswer) {
    // Guard: if either value is missing, there's nothing to compare.
    if (!this.securityAnswer || !candidateAnswer) return false;

    // Normalise the input for case‑insensitive comparison
    const normalizedAnswer = candidateAnswer.trim().toLowerCase();

    // If the stored answer is hashed (starts with `$2`), use bcrypt.
    if (this.securityAnswer.startsWith(HASH_PREFIX)) {
      return bcrypt.compare(normalizedAnswer, this.securityAnswer);
    }

    // Legacy plaintext comparison (pre‑hashing era).
    // This branch can be removed once all legacy data is migrated.
    return (
      this.securityAnswer.trim().toLowerCase() === normalizedAnswer
    );
  };

// ----------------------------------------------------------------------
// Model Export
// ----------------------------------------------------------------------

/**
 * The Mongoose User model.
 *
 * Usage:
 * ```
 * import User from '../models/User.js';
 *
 * const user = await User.findOne({ email: 'user@example.com' });
 * const isMatch = await user.comparePassword('password123');
 * ```
 */
export default mongoose.model('User', userSchema);