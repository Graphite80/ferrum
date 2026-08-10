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
  let armed = false;
  const applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      armApply();
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // onNeedRefresh only fires on the updatefound transition. A build that
      // finished installing during a previous page life — while a workout was
      // open, or simply before a reload — is already sitting in `waiting` when
      // this tab starts, so no transition is left to observe and nothing would
      // ever apply it. That is not a rare race: it pinned production on a build
      // eight commits old with the new one installed and waiting.
      if (registration.waiting !== null) armApply();
      const checkForUpdate = (): void => {
        registration.update().then(
          () => {
            if (registration.waiting !== null) armApply();
          },
          () => {
            /* offline, or the server is down: the next check is 15 minutes away */
          }
        );
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

  function armApply(): void {
    if (armed) return;
    armed = true;
    const applyIfIdle = (): boolean => {
      if (isBusy()) return false;
      void applyUpdate(true);
      return true;
    };
    if (applyIfIdle()) return;
    const retry = setInterval(() => {
      if (applyIfIdle()) clearInterval(retry);
    }, APPLY_RETRY_MS);
  }
}
