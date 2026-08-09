import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { installClientTelemetry } from './platform/client-telemetry.ts';
import { initServiceWorker } from './platform/sw-update.ts';
import './index.css';

// An error nobody can see did not get fixed: this app runs offline-first on a
// phone, so without a report a broken build is just "it stopped working".
installClientTelemetry({
  endpoint: '/api/v1/client-errors',
  appVersion: document.querySelector('meta[name="app-version"]')?.getAttribute('content') ?? 'dev',
});

initServiceWorker();

// Best-effort protection against storage eviction; the result is advisory only.
if ('storage' in navigator && 'persist' in navigator.storage) {
  void navigator.storage
    .persist()
    .then(granted => {
      console.info(`Persistent storage ${granted ? 'granted' : 'not granted'}`);
    })
    .catch((error: unknown) => {
      console.info('Persistent storage request failed', error);
    });
}

const container = document.getElementById('root');
if (container == null) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
