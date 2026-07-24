import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '../../db/ferrum-db.ts';
import { getDeviceId, unacknowledgedCount } from '../../db/event-store.ts';
import {
  detectWakeLockSupport,
  WakeLockController,
  type WakeLockState,
} from '../../platform/wake-lock.ts';

interface Observation {
  at: number;
  kind: string;
  detail: string;
}

interface StorageReport {
  persisted: boolean;
  persistRequested: boolean | null;
  quotaBytes: number | null;
  usageBytes: number | null;
}

const TIMER_TARGET_SECONDS = 6 * 60;

// The DOM lib declares these as always present. This page exists precisely to find
// out what an unfamiliar iOS build actually does, so it treats them as optional and
// reports their absence rather than throwing on a device we have not seen.
interface MaybeStorageManager {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
}

const storageApi: MaybeStorageManager = navigator.storage;

// Spike A from the plan's phase 0. The gate is specific: a 45 minute workout must
// survive three backgroundings, one force quit and one service worker update
// without losing a set; the wake lock must hold or re-acquire; and the rest timer
// must still be correct after six minutes in the background. None of that can be
// observed from a desktop, so this page records the evidence on the device and
// the numbers are read off it afterwards.
export function SpikeA() {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [wakeLock, setWakeLock] = useState<WakeLockState | null>(null);
  const [storage, setStorage] = useState<StorageReport | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [eventCount, setEventCount] = useState(0);
  const [timerEndsAt, setTimerEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const controllerRef = useRef<WakeLockController | null>(null);
  if (controllerRef.current == null) controllerRef.current = new WakeLockController(setWakeLock);
  const controller = controllerRef.current;

  const record = useCallback((kind: string, detail: string) => {
    setObservations(previous => [{ at: Date.now(), kind, detail }, ...previous].slice(0, 200));
  }, []);

  useEffect(() => {
    setWakeLock(controller.state);
    void (async () => {
      setDeviceId(await getDeviceId());
      setEventCount(await unacknowledgedCount());
    })();

    const onVisibility = () => {
      record('visibilitychange', document.visibilityState);
      controller.handleVisibilityChange();
      setNow(Date.now());
    };
    const onFreeze = () => {
      record('freeze', 'page frozen by the platform');
    };
    const onResume = () => {
      record('resume', 'page resumed');
    };
    const onPageHide = (event: PageTransitionEvent) => {
      record('pagehide', `persisted=${String(event.persisted)}`);
    };

    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('freeze', onFreeze);
    document.addEventListener('resume', onResume);
    window.addEventListener('pagehide', onPageHide);

    const handle = window.setInterval(() => {
      setNow(Date.now());
    }, 500);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('freeze', onFreeze);
      document.removeEventListener('resume', onResume);
      window.removeEventListener('pagehide', onPageHide);
      window.clearInterval(handle);
    };
  }, [controller, record]);

  const inspectStorage = useCallback(async () => {
    const persisted = (await storageApi.persisted?.()) ?? false;
    const estimate = (await storageApi.estimate?.()) ?? {};
    setStorage({
      persisted,
      persistRequested: null,
      quotaBytes: estimate.quota ?? null,
      usageBytes: estimate.usage ?? null,
    });
    record('storage', `persisted=${String(persisted)} usage=${String(estimate.usage ?? 0)}`);
  }, [record]);

  useEffect(() => {
    void inspectStorage();
  }, [inspectStorage]);

  const support = detectWakeLockSupport();
  const remainingSeconds = timerEndsAt == null ? null : Math.round((timerEndsAt - now) / 1000);

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-4 p-4 pb-24 text-sm">
      <h1 className="text-xl font-bold">Spike A — device evidence</h1>

      <section className="rounded-xl border border-edge bg-surface p-3">
        <h2 className="mb-2 font-semibold">Environment</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-neutral-400">Device id</dt>
          <dd data-testid="spike-device-id">{deviceId}</dd>
          <dt className="text-neutral-400">Standalone</dt>
          <dd>{String(window.matchMedia('(display-mode: standalone)').matches)}</dd>
          <dt className="text-neutral-400">Wake lock verdict</dt>
          <dd data-testid="spike-wake-verdict">
            {support.kind === 'silently_broken'
              ? `broken on iOS ${support.iosVersion} (accepts and ignores)`
              : support.kind}
          </dd>
          <dt className="text-neutral-400">Wake lock held</dt>
          <dd>{String(wakeLock?.held ?? false)}</dd>
          <dt className="text-neutral-400">Unsynced events</dt>
          <dd>{eventCount}</dd>
          <dt className="text-neutral-400">User agent</dt>
          <dd className="break-all text-[10px] text-neutral-400">{navigator.userAgent}</dd>
        </dl>
      </section>

      <section className="rounded-xl border border-edge bg-surface p-3">
        <h2 className="mb-2 font-semibold">Storage</h2>
        {storage == null ? (
          <p className="text-neutral-400">measuring…</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-neutral-400">Persisted</dt>
            <dd data-testid="spike-persisted">{String(storage.persisted)}</dd>
            <dt className="text-neutral-400">Quota</dt>
            <dd>{formatBytes(storage.quotaBytes)}</dd>
            <dt className="text-neutral-400">Usage</dt>
            <dd>{formatBytes(storage.usageBytes)}</dd>
          </dl>
        )}
        <button
          type="button"
          className="tap-target mt-2 w-full rounded-lg border border-edge"
          onClick={() => {
            void (async () => {
              const granted = (await storageApi.persist?.()) ?? false;
              record('storage.persist', `granted=${String(granted)}`);
              await inspectStorage();
            })();
          }}
        >
          Request persistent storage
        </button>
      </section>

      <section className="rounded-xl border border-edge bg-surface p-3">
        <h2 className="mb-2 font-semibold">Six-minute background timer</h2>
        <p className="mb-2 text-xs text-neutral-400">
          Start it, lock the phone or switch apps for six minutes, then come back. Drift is measured
          against the stored end time, which is the only number that survives a suspended tab.
        </p>
        <p className="text-2xl font-bold" data-testid="spike-timer">
          {remainingSeconds == null ? '—' : `${String(remainingSeconds)}s remaining`}
        </p>
        {remainingSeconds != null && (
          <p className="text-xs text-neutral-400">
            elapsed {String(TIMER_TARGET_SECONDS - remainingSeconds)}s of {TIMER_TARGET_SECONDS}s
          </p>
        )}
        <button
          type="button"
          className="tap-target mt-2 w-full rounded-lg bg-accent font-bold text-black"
          onClick={() => {
            const ends = Date.now() + TIMER_TARGET_SECONDS * 1000;
            setTimerEndsAt(ends);
            record('timer.start', `endsAt=${String(ends)}`);
            void controller.request();
          }}
        >
          Start 6:00 and hold the screen awake
        </button>
      </section>

      <section className="rounded-xl border border-edge bg-surface p-3">
        <h2 className="mb-2 font-semibold">Write durability</h2>
        <button
          type="button"
          className="tap-target w-full rounded-lg border border-edge"
          onClick={() => {
            void (async () => {
              const started = performance.now();
              await db.transaction('rw', db.snapshots, async () => {
                await db.snapshots.put({
                  sessionId: `spike-${String(Date.now())}`,
                  updatedAtMillis: Date.now(),
                  upToOrderKey: '',
                  payload: { probe: true },
                });
              });
              record('idb.write', `committed in ${(performance.now() - started).toFixed(1)}ms`);
            })();
          }}
        >
          Commit a probe write
        </button>
      </section>

      <section className="rounded-xl border border-edge bg-surface p-3">
        <h2 className="mb-2 font-semibold">Observations ({observations.length})</h2>
        <ul className="flex flex-col gap-1 text-[11px]" data-testid="spike-observations">
          {observations.map(observation => (
            <li key={`${String(observation.at)}-${observation.kind}`} className="flex gap-2">
              <span className="text-neutral-500">
                {new Date(observation.at).toISOString().slice(11, 19)}
              </span>
              <span className="text-neutral-300">{observation.kind}</span>
              <span className="text-neutral-400">{observation.detail}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function formatBytes(value: number | null): string {
  if (value == null) return 'unknown';
  const megabytes = value / (1024 * 1024);
  return megabytes > 1024 ? `${(megabytes / 1024).toFixed(2)} GB` : `${megabytes.toFixed(1)} MB`;
}
