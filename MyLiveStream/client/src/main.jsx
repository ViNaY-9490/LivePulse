/**
 * -------------------------------------------------------
 * File: main.jsx
 * Purpose:
 * The application entry point. Bootstraps the React
 * component tree, mounts it to the DOM, and wraps it in
 * all required global providers.
 *
 * This file is the first JavaScript that executes. It
 * sets up the infrastructure that every component
 * depends on: Redux state management, React Query for
 * server state, theming, WebSocket connectivity, and
 * client‑side routing.
 *
 * Provider Nesting Order (outer → inner):
 * 1. `<Provider store={store}>` — Redux: global client state.
 * 2. `<QueryClientProvider>` — React Query: server state + caching.
 * 3. `<ThemeProvider>` — Light/dark theme context.
 * 4. `<SocketProvider>` — WebSocket connection lifecycle.
 * 5. `<BrowserRouter>` — Client‑side routing (must be inside
 *    all providers so route components can access them).
 * 6. `<App />` — The root component (routes, auth init).
 *
 * Why this order:
 * - Redux and React Query are at the top because everything
 *   may need them.
 * - ThemeProvider must wrap the entire tree so `useTheme()`
 *   is available everywhere.
 * - SocketProvider must wrap BrowserRouter so that page
 *   components can access the socket.
 * - BrowserRouter is last among providers (but still wraps
 *   `<App />`) because routing should be the outermost
 *   UI concern.
 * - `<React.StrictMode>` wraps everything to enable React's
 *   development‑mode checks (double‑rendering, warnings).
 *
 * Important Notes:
 * - `React.StrictMode` is intentionally the outermost
 *   wrapper. It does not affect production builds.
 * - The `QueryClient` is created with default options.
 *   Custom defaults (stale time, retry behaviour) can
 *   be passed to the constructor if needed.
 * - CSS is imported here so it's bundled and applied
 *   before any component renders.
 *
 * Dependencies:
 * - react, react-dom: Core React libraries
 * - react-router-dom: Client‑side routing
 * - react-redux: Redux bindings for React
 * - @tanstack/react-query: Server state management
 * - ./redux/store: Configured Redux store
 * - ./App: Root application component
 * - ./index.css: Global Tailwind styles
 * - ./SocketContext: WebSocket provider
 * - ./ThemeContext: Theme provider
 * -------------------------------------------------------
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import store from './redux/store';
import App from './App';
import './index.css';
import { SocketProvider } from './SocketContext';
import { ThemeProvider } from './ThemeContext';

// ----------------------------------------------------------------------
// React Query Client
// ----------------------------------------------------------------------

/**
 * The singleton React Query client instance.
 *
 * Created with default options. To customise global behaviour,
 * pass a configuration object:
 *
 * ```
 * const queryClient = new QueryClient({
 *   defaultOptions: {
 *     queries: {
 *       staleTime: 5 * 60 * 1000,    // 5 minutes
 *       retry: 2,                     // Retry twice on failure
 *       refetchOnWindowFocus: false,  // Don't refetch on tab switch
 *     },
 *   },
 * });
 * ```
 *
 * Why a single instance:
 * React Query's cache is stored in the QueryClient. Creating
 * multiple instances would create separate, disconnected caches.
 */
const queryClient = new QueryClient();

// ----------------------------------------------------------------------
// DOM Mount
// ----------------------------------------------------------------------

/**
 * Renders the entire application into the DOM.
 *
 * `createRoot` is the React 18 API for concurrent rendering.
 * It replaces the legacy `ReactDOM.render()` and enables
 * features like automatic batching and transitions.
 *
 * The `!` assertion tells TypeScript that `getElementById`
 * will not return null (the HTML file is guaranteed to have
 * a `<div id="root">` element). In JavaScript this is not
 * strictly necessary but serves as documentation of the
 * assumption.
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  /**
   * React Strict Mode
   *
   * Wraps the entire tree in development to:
   * - Detect unexpected side effects by double‑invoking
   *   render and effect functions.
   * - Warn about deprecated APIs.
   * - Help prepare for future React features.
   *
   * It has zero impact on production builds.
   */
  <React.StrictMode>
    {/* ---- Redux: Global client state ---- */}
    <Provider store={store}>
      {/* ---- React Query: Server state + caching ---- */}
      <QueryClientProvider client={queryClient}>
        {/* ---- Theme: Light/dark mode ---- */}
        <ThemeProvider>
          {/* ---- WebSocket: Real‑time connectivity ---- */}
          <SocketProvider>
            {/* ---- Router: Client‑side navigation ---- */}
            <BrowserRouter>
              {/* Root component — routes, auth init, layout */}
              <App />
            </BrowserRouter>
          </SocketProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </Provider>
  </React.StrictMode>,
);