// eslint-disable-next-line import/no-unresolved -- virtual module provided by vite-plugin-pwa
import { registerSW } from 'virtual:pwa-register';

type Listener = (ready: boolean) => void;

let updateReady = false;
let apply: ((reloadPage?: boolean) => Promise<void>) | null = null;
const listeners = new Set<Listener>();

// registerType is 'prompt': the waiting worker stays waiting until the user asks
// for it. Nothing here ever reloads the page on its own — a swap mid-workout is a
// data-loss shaped surprise even when no data is actually lost.
export function initServiceWorker(): void {
  apply = registerSW({
    onNeedRefresh() {
      updateReady = true;
      for (const listener of listeners) listener(true);
    },
  });
}

export function subscribeUpdateReady(listener: Listener): () => void {
  listeners.add(listener);
  listener(updateReady);
  return () => {
    listeners.delete(listener);
  };
}

export function applyUpdate(): void {
  void apply?.(true);
}
