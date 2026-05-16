/**
 * -------------------------------------------------------
 * File: utils/sendEmail.js
 * Purpose:
 * Sends transactional emails using Nodemailer and SMTP.
 * Currently used for OTP (one‑time password) delivery
 * during signup and login verification flows.
 *
 * This module is the single place where email transport
 * is configured. If the email provider changes (e.g., from
 * SMTP to SendGrid or AWS SES), only this file needs to
 * be updated.
 *
 * High‑Level Workflow:
 * 1. `createTransporter()` creates a reusable Nodemailer
 *    transport configured from environment variables.
 * 2. `sendOTP(to, otp)` sends an OTP email to the specified
 *    address using a pre‑formatted HTML template.
 *
 * Design Decisions:
 * - **Transporter created per‑send:** A new transporter is
 *   created each time `sendOTP` is called. For low‑volume
 *   email (auth only), this is fine. For high‑volume email,
 *   the transporter should be created once at module scope
 *   and reused. Nodemailer handles connection pooling
 *   automatically for reused transporters.
 * - **`secure: EMAIL_PORT === 465`:** Port 465 uses implicit
 *   TLS (SSL). Port 587 uses STARTTLS (explicit TLS upgrade).
 *   This is the Nodemailer convention.
 * - **Error handling delegated to caller:** `sendOTP` throws
 *   on failure. The caller (auth controller) catches the
 *   error and handles it (e.g., rolling back user creation).
 *   This keeps the email module focused on sending and the
 *   controller focused on business logic.
 *
 * Security Notes:
 * - Email credentials (`EMAIL_USER`, `EMAIL_PASS`) are
 *   stored in environment variables, never in code.
 * - For Gmail, use an "App Password" rather than the
 *   account's main password.
 *
 * Edge Cases Handled:
 * - **Email not configured** → `createTransporter` throws
 *   immediately with a clear error, preventing undefined
 *   behaviour downstream.
 * - **All email config present but invalid** → Nodemailer
 *   throws on `sendMail`; the error propagates to the caller.
 *
 * Dependencies:
 * - nodemailer: Email sending library
 * - ../config/env.js: SMTP configuration
 * -------------------------------------------------------
 */

import nodemailer from 'nodemailer';
import {
  EMAIL_HOST,
  EMAIL_PASS,
  EMAIL_PORT,
  EMAIL_USER,
} from '../config/env.js';

// ----------------------------------------------------------------------
// Transporter Factory
// ----------------------------------------------------------------------

/**
 * Creates a Nodemailer transporter configured from environment
 * variables.
 *
 * Why a factory function instead of a module‑scoped transporter:
 * - Throws immediately if email is not configured, giving a
 *   clear error at the point of use.
 * - Allows the auth controller to catch configuration errors
 *   and return a proper response rather than crashing the server.
 * - For production, consider creating the transporter once at
 *   module scope and reusing it — Nodemailer handles connection
 *   pooling automatically for persistent transporters.
 *
 * @returns {import('nodemailer').Transporter} A configured transporter
 * @throws {Error} If any required email environment variable is missing
 */
const createTransporter = () => {
  /**
   * Validate that all required email configuration is present.
   *
   * Why fail here rather than letting Nodemailer fail:
   * Nodemailer's error messages for missing configuration are
   * less clear. This gives a specific, actionable message.
   */
  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS) {
    throw new Error('Email delivery is not configured');
  }

  /**
   * Create the transporter.
   *
   * Configuration:
   * - `host`: SMTP server hostname (e.g., smtp.gmail.com).
   * - `port`: SMTP port (587 for STARTTLS, 465 for SSL).
   * - `secure`: `true` for port 465 (implicit TLS), `false`
   *   for port 587 (STARTTLS). This matches Nodemailer's
   *   documented convention.
   * - `auth`: Credentials for SMTP authentication.
   */
  return nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_PORT === 465,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
  });
};

// ----------------------------------------------------------------------
// OTP Email
// ----------------------------------------------------------------------

/**
 * Sends an OTP verification code to the specified email address.
 *
 * The email includes:
 * - The OTP code prominently displayed.
 * - The expiry duration (10 minutes) so the user knows the
 *   code is time‑limited.
 *
 * Why a dedicated function instead of a generic `sendEmail`:
 * - The OTP email template is specific to this use case.
 * - A generic `sendEmail` can be added later if other email
 *   types are needed (welcome emails, password reset, etc.).
 *
 * @param {string} to - Recipient email address
 * @param {string} otp - The 6‑digit OTP to include in the email
 * @returns {Promise<void>} Resolves when the email is sent
 * @throws {Error} If the transporter cannot be created or
 *   `sendMail` fails (e.g., invalid credentials, network error)
 *
 * @example
 * await sendOTP('user@example.com', '123456');
 */
const sendOTP = async (to, otp) => {
  const transporter = createTransporter();

  /**
   * Send the email.
   *
   * `from`: Uses the format `"Display Name" <email>` for
   * better deliverability and user recognition.
   *
   * `html`: A simple, centred HTML template. Inline styles
   * are used because many email clients strip `<style>` blocks.
   */
  await transporter.sendMail({
    from: `"LivePulse" <${EMAIL_USER}>`,
    to,
    subject: 'Your LivePulse verification code',
    html: `
      <div style="text-align: center; font-family: Arial, sans-serif;">
        <h1 style="color: #333;">Your OTP is:</h1>
        <p style="font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #4F46E5;">
          ${otp}
        </p>
        <p style="color: #666;">It expires in 10 minutes.</p>
      </div>
    `,
  });
};

// ----------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------

export { sendOTP };