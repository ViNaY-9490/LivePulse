import https from 'https';
import { BREVO_API_KEY, EMAIL_USER } from '../config/env.js';

/**
 * Sends a 6-digit OTP to a user's email using the Brevo REST API.
 * 
 * This uses the Brevo (formerly Sendinblue) transactional email API.
 * We use the native Node.js 'https' module to avoid extra dependencies 
 * like axios or node-fetch, ensuring compatibility across environments 
 * (like Render free tier) that might block certain ports or packages.
 *
 * @param {string} email - The recipient's email address.
 * @param {string} otp - The 6-digit code to send.
 * @returns {Promise<boolean>} - Resolves to true on success, or throws an error.
 */
export const sendOTP = async (email, otp) => {
  // If the API key is missing, log the OTP for development and return.
  // This allows the server to run locally without an email service.
  if (!BREVO_API_KEY) {
    console.log('=================================');
    console.log('BREVO_API_KEY NOT SET');
    console.log('OTP FOR TESTING:', otp);
    console.log('EMAIL:', email);
    console.log('=================================');
    return true;
  }

  const data = JSON.stringify({
    sender: {
      name: 'LivePulse',
      email: EMAIL_USER || 'noreply@livepulse.com',
    },
    to: [{ email }],
    subject: 'Your LivePulse Verification Code',
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
        <h2 style="color: #333; text-align: center;">Welcome to LivePulse</h2>
        <p style="font-size: 16px; color: #555;">To complete your verification, please use the following One-Time Password (OTP):</p>
        <div style="background: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #000; margin: 20px 0; border-radius: 5px;">
          ${otp}
        </div>
        <p style="font-size: 14px; color: #777;">This code is valid for 10 minutes. If you did not request this, please ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #aaa; text-align: center;">&copy; 2026 LivePulse Streaming. All rights reserved.</p>
      </div>
    `,
  });

  const options = {
    hostname: 'api.brevo.com',
    port: 443,
    path: '/v3/smtp/email',
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(data),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseBody = '';

      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[Email] OTP sent successfully to ${email}`);
          resolve(true);
        } else {
          console.error(`[Email] Brevo API Error (${res.statusCode}):`, responseBody);
          reject(new Error(`Brevo API returned ${res.statusCode}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('[Email] Request Error:', error);
      reject(error);
    });

    req.write(data);
    req.end();
  });
};
