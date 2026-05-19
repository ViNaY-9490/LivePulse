export const sendOTP = async (email, otp) => {
  try {
    // =====================================
    // DEVELOPMENT MODE
    // =====================================

    // Skip SMTP completely because
    // Render free tier blocks SMTP ports

    console.log('=================================');
    console.log('OTP FOR TESTING:', otp);
    console.log('EMAIL:', email);
    console.log('=================================');

    // Simulate successful email sending
    return true;
  } catch (error) {
    console.error('MAIL ERROR:', error);

    return true;
  }
};