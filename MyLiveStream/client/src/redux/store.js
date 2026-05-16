/**
 * -------------------------------------------------------
 * File: redux/store.js
 * Purpose:
 * Configures and exports the centralised Redux store for
 * the application.
 *
 * This is the single source of truth for all global
 * application state. It assembles all slice reducers into
 * a single store using Redux Toolkit's `configureStore`.
 *
 * Why Redux Toolkit:
 * - `configureStore` automatically sets up the Redux DevTools
 *   extension, Thunk middleware, and sensible defaults.
 * - Development‑friendly checks (e.g., accidental state
 *   mutation warnings) are enabled out of the box.
 * - Less boilerplate than manual `createStore` setup.
 *
 * Current Slices:
 * - `auth`: User authentication state (credentials, session)
 *
 * To Add a New Slice:
 * 1. Import the reducer (e.g., `import streamReducer from './streamSlice'`).
 * 2. Add it to the `reducer` object below.
 * 3. The slice's state is now accessible via `state.stream`.
 *
 * Important Notes:
 * - Redux state is ephemeral (cleared on page refresh).
 *   Persistent data like auth tokens are stored in
 *   `localStorage` separately.
 * - The store is a singleton — there should be only one
 *   instance created and exported.
 * - For TypeScript projects, you'd additionally export
 *   `RootState` and `AppDispatch` types from this file.
 *
 * Dependencies:
 * - @reduxjs/toolkit: `configureStore`
 * - ./authSlice: Authentication reducer
 * -------------------------------------------------------
 */

import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice';

// ----------------------------------------------------------------------
// Store Configuration
// ----------------------------------------------------------------------

/**
 * The centralised Redux store.
 *
 * Created with `configureStore`, which automatically:
 * - Activates the Redux DevTools browser extension (in development).
 * - Adds `redux-thunk` middleware for async actions.
 * - Enables development‑mode checks for state mutations and
 *   non‑serializable values in actions/state.
 *
 * Why only one reducer right now:
 * The application is authentication‑focused. As new features
 * (chat, streaming, reactions) are added, their reducers will
 * be added to the `reducer` map below.
 *
 * @example
 * // Access auth state in a component:
 * const user = useSelector((state) => state.auth.user);
 *
 * @example
 * // Dispatch an action:
 * import { setCredentials } from './authSlice';
 * dispatch(setCredentials({ user, accessToken, refreshToken }));
 */
const store = configureStore({
  reducer: {
    // Authentication slice — manages user, tokens, and session status.
    // Access via `state.auth` in selectors.
    auth: authReducer,

    // Future slices would be added here:
    // stream: streamReducer,
    // chat: chatReducer,
    // reactions: reactionsReducer,
  },
});

// ----------------------------------------------------------------------
// Export
// ----------------------------------------------------------------------

/**
 * The fully configured Redux store instance.
 *
 * This singleton is imported by:
 * - The React `<Provider>` in the app entry point.
 * - The Axios interceptor (for dispatching logout on 401).
 * - Any utility that needs direct store access (rare).
 */
export default store;