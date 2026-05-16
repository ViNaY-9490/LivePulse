/**
 * -------------------------------------------------------
 * File: components/OTPInput.jsx
 * Purpose:
 * Renders a multi‑digit One‑Time Password (OTP) input
 * field commonly used for two‑factor authentication (2FA),
 * email/phone verification, and passwordless login.
 *
 * This component provides a polished user experience by:
 * - Auto‑focusing the next input on digit entry
 * - Allowing paste of a full OTP string into any field
 * - Handling backspace to focus the previous field
 * - Using Framer Motion for subtle focus animations
 * - Restricting input to numeric characters only
 *
 * Behavioural Details:
 * - `onChange` is called with the complete OTP string
 *   whenever any digit changes, allowing the parent
 *   form to validate the full code in real time.
 * - The paste handler distributes digits across fields,
 *   enabling users to paste from password managers or
 *   autofill services.
 * - Backspace on an empty field moves focus left, which
 *   is the intuitive behaviour in most OTP UIs.
 *
 * Dependencies:
 * - react (useRef, useState)
 * - framer-motion (for per‑digit focus animation)
 * -------------------------------------------------------
 */

import { useRef, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * OTPInput Component
 *
 * Renders a row of single‑character inputs that together
 * form an OTP code. Manages focus navigation, paste
 * handling, and value synchronisation.
 *
 * @param {object} props
 * @param {number} [props.length=6] - Number of OTP digits
 * @param {function} props.onChange - Callback invoked with
 *        the complete OTP string whenever a digit changes.
 */
const OTPInput = ({ length = 6, onChange }) => {
  // Holds the current value of each digit as an array of strings.
  // Initialised with empty strings so all fields appear blank.
  const [otp, setOtp] = useState(new Array(length).fill(''));

  // Ref array stores direct references to each input DOM node,
  // enabling imperative focus management without query selectors.
  const inputsRef = useRef([]);

  /**
   * Handles the `onChange` event for any OTP digit input.
   *
   * Two code paths exist:
   * 1. Multi‑character input (paste / autofill):
   *    Distributes the characters across subsequent fields
   *    and advances focus to the last filled position.
   * 2. Single‑character input (manual typing):
   *    Places the last typed character into the current field
   *    and advances focus to the next field if applicable.
   *
   * @param {object} e - React change event
   * @param {number} index - Index of the input that changed
   */
  const handleChange = (e, index) => {
    // Strip any non‑digit characters (e.g., spaces, dashes from paste)
    const value = e.target.value.replace(/\D/g, '');
    const newOtp = [...otp];

    // --- Paste / autofill path (multiple characters at once) ---
    if (value.length > 1) {
      // Distribute characters starting from the current index.
      // `slice(0, length - index)` prevents overflow beyond the last field.
      value
        .slice(0, length - index)
        .split('')
        .forEach((digit, offset) => {
          newOtp[index + offset] = digit;
        });

      setOtp(newOtp);
      onChange(newOtp.join(''));

      // Advance focus to the last field that received a character.
      const nextIndex = Math.min(index + value.length, length - 1);
      inputsRef.current[nextIndex]?.focus();
      return;
    }

    // --- Manual single‑character path ---
    // Only keep the very last character typed (handles edge cases
    // like rapid keystrokes or auto‑complete quirks).
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);
    onChange(newOtp.join(''));

    // If a character was entered and there's a next field, focus it.
    if (value && index < length - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  /**
   * Handles the `onKeyDown` event for backspace navigation.
   *
   * When the user presses Backspace on an already‑empty field,
   * focus moves to the previous field so they can edit an
   * earlier digit without using the mouse.
   *
   * @param {object} e - React keyboard event
   * @param {number} index - Index of the input receiving the keypress
   */
  const handleKeyDown = (e, index) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  return (
    <div className="flex justify-center gap-2 md:gap-4">
      {otp.map((digit, idx) => (
        <motion.input
          key={idx}
          // Gentle scale + lift on focus gives each digit a
          // "selected" feel without overwhelming the UI.
          whileFocus={{ scale: 1.05, y: -2 }}
          // Store each input reference so we can call .focus() imperatively.
          ref={(el) => (inputsRef.current[idx] = el)}
          type="text"
          // `inputMode="numeric"` shows the numeric keyboard on mobile
          // while avoiding the up/down spinner that `type="number"` adds.
          inputMode="numeric"
          // `maxLength={1}` limits the field to a single character.
          // Combined with the `onChange` logic, this prevents overflow.
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(e, idx)}
          onKeyDown={(e) => handleKeyDown(e, idx)}
          className="w-10 h-12 md:w-12 md:h-14 text-center bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white text-xl font-bold focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 transition-all shadow-sm"
        />
      ))}
    </div>
  );
};

export default OTPInput;