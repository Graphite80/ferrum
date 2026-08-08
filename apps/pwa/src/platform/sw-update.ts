// eslint-disable-next-line import/no-unresolved -- virtual module provided by vite-plugin-pwa
import { registerSW } from 'virtual:pwa-register';

const POLL_INTERVAL_MS = 15 * 60 * 1000;
const APPLY_RETRY_MS = 30 * 1000;

// A workout is the one thing a reload would interrupt; every other screen can be
// swapped under the user without costing anything. The path is the whole state —
// no store to thread through here.
const isBusy = (): boolean => window.location.pathname.startsWith('/workout/');

// Silent auto-update: no toast, no button. An update the user has to acknowledge is
// an update that never lands on a phone kept in a pocket between sets, so the new
// build is applied the moment it cannot interrupt anyone, and the page reloads into
// it. registerType stays 'prompt' precisely so this file decides *when*.
export function initServiceWorker(): void {
  const applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      const applyIfIdle = (): boolean => {
        if (isBusy()) return false;
        void applyUpdate(true);
        return true;
      };
      if (applyIfIdle()) return;
      const retry = setInterval(() => {
        if (applyIfIdle()) clearInterval(retry);
      }, APPLY_RETRY_MS);
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const checkForUpdate = (): void => {
        registration.update().catch(() => {});
      };
      // A tab left open for days would otherwise never look. Poll, and also check
      // the moment the user comes back to it — that is when a stale build is both
      // most likely and most cheaply replaced.
      setInterval(checkForUpdate, POLL_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
    },
  });
}
