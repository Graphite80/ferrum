import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initServiceWorker } from './platform/sw-update.ts';
import './index.css';

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
    <App />
  </StrictMode>
);
