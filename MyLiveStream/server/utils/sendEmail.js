import nodemailer from 'nodemailer';

// ==============================
// Nodemailer / Mailtrap Config
// ==============================

// Create reusable transporter object using Mailtrap SMTP
const createTransporter = () => {
  return nodemailer.createTransport({
    // Mailtrap SMTP host
    host: process.env.EMAIL_HOST,

    // Mailtrap SMTP port
    port: Number(process.env.EMAIL_PORT),

    // Use secure connection only for port 465
    secure: false,

    // Force IPv4 to avoid potential IPv6 issues
    family: 4,

    // SMTP authentication
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },

    // Optional TLS config
    tls: {
      rejectUnauthorized: false,
    },

    // Prevent hanging forever on connection
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,

    // Enable SMTP debugging
    logger: true,
    debug: true,
  });
};

// ==============================
// Send OTP Email Function
// ==============================

export const sendOTP = async (email, otp) => {
  try {
    // Create transporter
    const transporter = createTransporter();

    console.log('Verifying SMTP connection...');

    // Verify SMTP connection
    await transporter.verify();

    console.log('SMTP server is ready');

    console.log('Sending OTP email...');

    // Send mail
    const info = await transporter.sendMail({
      from: `"LivePulse Security" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your LivePulse OTP Code',

      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>LivePulse Verification</h2>

          <p>Your OTP code is:</p>

          <h1 style="color: #4F46E5; letter-spacing: 5px;">
            ${otp}
          </h1>

          <p>This OTP will expire shortly.</p>

          <p>If you did not request this, please ignore this email.</p>
        </div>
      `,
    });

    console.log('OTP email sent successfully');
    console.log('Message ID:', info.messageId);

    return info;
  } catch (error) {
    console.error('MAIL ERROR:', error);

    // IMPORTANT:
    // Do not crash login flow if email fails
    // Print OTP in logs for development/testing

    console.log('=================================');
    console.log('OTP FOR TESTING:', otp);
    console.log('=================================');

    return true;
  }
};