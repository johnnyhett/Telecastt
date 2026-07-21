import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import './styles/theme.css';
import './styles/app.css';

import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

// Register the offline service worker only in production builds so it never
// interferes with hot-module reloading during development.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      /* offline support is best-effort */
    });
  });
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
