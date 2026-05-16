/**
 * -------------------------------------------------------
 * File: components/SecurityQuestionInput.jsx
 * Purpose:
 * Renders a labelled text input for answering a
 * security question during account recovery or
 * identity verification flows.
 *
 * This component is intentionally simple: it displays
 * a pre‑selected security question (immutable in this
 * context) and provides a controlled input for the
 * user's answer.
 *
 * Design Decisions:
 * - The question text is passed as a prop rather than
 *   fetched internally, keeping the component "dumb"
 *   and reusable across different verification steps.
 * - The input is a controlled component to allow the
 *   parent form to validate, debounce, or submit the
 *   answer without reading the DOM directly.
 * - Styling uses Tailwind utility classes consistent
 *   with the app's form field design language (rounded
 *   corners, focus ring, dark mode support).
 *
 * Accessibility:
 * - The `<label>` is explicitly associated with the
 *   `<input>` via the `htmlFor` / `id` pattern. This
 *   is critical for screen‑reader users navigating
 *   security‑sensitive flows.
 * -------------------------------------------------------
 */

/**
 * SecurityQuestionInput Component
 *
 * A labelled text input for answering a security question.
 *
 * @param {object} props
 * @param {string} props.question - The security question text displayed as the label
 * @param {string} props.answer - Current value of the answer input
 * @param {function} props.setAnswer - Setter for updating the answer value
 */
const SecurityQuestionInput = ({ question, answer, setAnswer }) => {
  // Generate a stable ID for the label/input association.
  // Using a deterministic ID based on the question string
  // keeps it consistent across renders while avoiding
  // collisions if multiple instances exist on the page.
  const inputId = `security-answer-${question.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div>
      {/* The label uses `htmlFor` to explicitly bind to the input.
          This ensures screen readers announce the question correctly. */}
      <label
        htmlFor={inputId}
        className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2"
      >
        {question}
      </label>

      <input
        id={inputId}
        type="text"
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 transition"
        placeholder="Your answer"
        required
      />
    </div>
  );
};

export default SecurityQuestionInput;