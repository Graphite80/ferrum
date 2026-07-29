import { liveQuery } from 'dexie';
import { type DomainEvent } from '@ferrum/domain';
import {
  PULL_DEFAULT_LIMIT,
  isProtocolError,
  parsePullResponse,
  parsePushResponse,
  serializePushRequest,
} from '@ferrum/sync-protocol';
import { db, withDatabaseRecovery } from '../db/ferrum-db.ts';
import {
  importRemoteEvents,
  markAcknowledged,
  unacknowledgedBatch,
  unacknowledgedCount,
} from '../db/event-store.ts';

export interface SyncConfig {
  readonly serverUrl: string | null;
  readonly syncToken: string | null;
}

export interface SyncStatus {
  readonly configured: boolean;
  readonly syncing: boolean;
  readonly pendingCount: number;
  readonly cursor: number;
  readonly lastSuccessAtMillis: number | null;
  readonly lastError: string | null;
  readonly driftMessage: string | null;
}

export type SyncTrigger =
  'start' | 'append' | 'online' | 'visible' | 'manual' | 'retry' | 'coalesced';

export interface SyncState {
  readonly cursor: number;
  readonly lastSuccessAtMillis: number | null;
  readonly driftMessage: string | null;
}

export interface PushableEvent {
  readonly eventId: string;
  readonly envelope: DomainEvent;
}

export type TimerHandle = ReturnType<typeof setTimeout>;

export interface SyncClientDeps {
  readonly loadConfig: () => Promise<SyncConfig>;
  readonly loadState: () => Promise<SyncState>;
  readonly saveState: (patch: Partial<SyncState>) => Promise<void>;
  readonly unacknowledgedBatch: (limit: number) => Promise<readonly PushableEvent[]>;
  readonly markAcknowledged: (eventIds: readonly string[]) => Promise<void>;
  readonly importRemoteEvents: (
    events: readonly DomainEvent[],
    nowMillis: number
  ) => Promise<number>;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly now: () => number;
  readonly random: () => number;
  readonly setTimer: (callback: () => void, delayMillis: number) => TimerHandle;
  readonly clearTimer: (handle: TimerHandle) => void;
}

export const PUSH_BATCH_LIMIT = 500;
export const APPEND_DEBOUNCE_MILLIS = 2_000;
export const BACKOFF_BASE_MILLIS = 5_000;
export const BACKOFF_CAP_MILLIS = 300_000;
export const DRIFT_RETRY_MILLIS = 3_600_000;
const REQUEST_TIMEOUT_MILLIS = 20_000;

class ClockDriftSyncError extends Error {
  constructor(driftedCount: number) {
    super(
      `Server rejected ${String(driftedCount)} event(s): this device's clock is too far ` +
        `ahead of the server. Fix the device clock; sync will retry hourly.`
    );
    this.name = 'ClockDriftSyncError';
  }
}

type StatusListener = (status: SyncStatus) => void;

interface SyncTarget {
  readonly serverUrl: string;
  readonly syncToken: string;
}

export class SyncClient {
  private status: SyncStatus = {
    configured: false,
    syncing: false,
    pendingCount: 0,
    cursor: 0,
    lastSuccessAtMillis: null,
    lastError: null,
    driftMessage: null,
  };

  private readonly statusListeners = new Set<StatusListener>();
  private started = false;
  private cycleInFlight = false;
  private rerunRequested = false;
  private failureCount = 0;
  private lastDriftAtMillis = 0;
  private retryTimer: TimerHandle | null = null;
  private appendTimer: TimerHandle | null = null;

  constructor(private readonly deps: SyncClientDeps) {}

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  noteConfigSaved(config: SyncConfig): void {
    this.publish({
      configured: config.serverUrl !== null && config.syncToken !== null,
      lastError: null,
    });
  }

  // The unacknowledged count is the write signal: pulled events land already
  // acknowledged, so anything still pending was appended by this device. Arming
  // on any non-zero count rather than on a rise is deliberate: Dexie collapses a
  // mutation that lands mid-query into a single emission, so an append that
  // coalesces with the recount after an acknowledgement would otherwise never
  // schedule its push. The debounce and the single-flight guard absorb the extra
  // calls this costs.
  notePendingCount(count: number): void {
    this.publish({ pendingCount: count });
    if (count > 0) this.scheduleAppendSync();
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const [state, config] = await Promise.all([this.deps.loadState(), this.deps.loadConfig()]);
    this.publish({
      configured: config.serverUrl !== null && config.syncToken !== null,
      cursor: state.cursor,
      lastSuccessAtMillis: state.lastSuccessAtMillis,
      driftMessage: state.driftMessage,
    });
    this.requestSync('start');
  }

  requestSync(trigger: SyncTrigger): void {
    if (this.cycleInFlight) {
      this.rerunRequested = true;
      return;
    }
    const driftGateActive =
      this.status.driftMessage !== null &&
      trigger !== 'manual' &&
      trigger !== 'retry' &&
      this.deps.now() - this.lastDriftAtMillis < DRIFT_RETRY_MILLIS;
    if (driftGateActive) return;
    if (trigger === 'manual' && this.retryTimer !== null) {
      this.deps.clearTimer(this.retryTimer);
      this.retryTimer = null;
      this.failureCount = 0;
    }
    // An armed backoff owns the schedule: ambient triggers (visibility, online,
    // append) must not turn every app switch into an immediate hammer while the
    // server is down. Manual and the retry timer itself still pass.
    if (this.retryTimer !== null && trigger !== 'manual' && trigger !== 'retry') return;
    this.cycleInFlight = true;
    void this.runCycle().finally(() => {
      this.cycleInFlight = false;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        this.requestSync('coalesced');
      }
    });
  }

  private publish(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.statusListeners) listener(this.status);
  }

  private scheduleRetry(delayMillis: number): void {
    if (this.retryTimer !== null) this.deps.clearTimer(this.retryTimer);
    this.retryTimer = this.deps.setTimer(() => {
      this.retryTimer = null;
      this.requestSync('retry');
    }, delayMillis);
  }

  private scheduleAppendSync(): void {
    if (this.appendTimer !== null) this.deps.clearTimer(this.appendTimer);
    this.appendTimer = this.deps.setTimer(() => {
      this.appendTimer = null;
      this.requestSync('append');
    }, APPEND_DEBOUNCE_MILLIS);
  }

  private async runCycle(): Promise<void> {
    try {
      const config = await this.deps.loadConfig();
      if (config.serverUrl === null || config.syncToken === null) {
        this.publish({ configured: false, syncing: false });
        return;
      }
      const target = { serverUrl: config.serverUrl, syncToken: config.syncToken };
      this.publish({ configured: true, syncing: true });
      await this.pushAll(target);
      await this.pullAll(target);
      this.failureCount = 0;
      const now = this.deps.now();
      await this.deps.saveState({ lastSuccessAtMillis: now, driftMessage: null });
      this.publish({
        syncing: false,
        lastSuccessAtMillis: now,
        lastError: null,
        driftMessage: null,
      });
    } catch (error) {
      if (error instanceof ClockDriftSyncError) {
        this.lastDriftAtMillis = this.deps.now();
        await this.deps.saveState({ driftMessage: error.message });
        this.publish({ syncing: false, driftMessage: error.message, lastError: null });
        this.scheduleRetry(DRIFT_RETRY_MILLIS);
        return;
      }
      this.failureCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      this.publish({ syncing: false, lastError: message });
      // Jitter keeps a fleet of devices that failed together from retrying in
      // lockstep against a single replica the moment it recovers.
      const backoff = Math.min(
        BACKOFF_BASE_MILLIS * 2 ** (this.failureCount - 1),
        BACKOFF_CAP_MILLIS
      );
      this.scheduleRetry(backoff * (0.5 + this.deps.random() * 0.5));
    }
  }

  private async callServer(
    target: SyncTarget,
    path: string,
    init: { method: 'GET' } | { method: 'POST'; body: string }
  ): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${target.syncToken}` };
    if (init.method === 'POST') headers['content-type'] = 'application/json';
    return this.deps.fetch(`${target.serverUrl.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLIS),
    });
  }

  private async pushAll(target: SyncTarget): Promise<void> {
    for (;;) {
      const batch = await this.deps.unacknowledgedBatch(PUSH_BATCH_LIMIT);
      const first = batch[0];
      if (first === undefined) return;
      const request = serializePushRequest({
        deviceId: first.envelope.deviceId,
        events: batch.map(row => row.envelope),
      });
      const response = await this.callServer(target, '/sync/push', {
        method: 'POST',
        body: JSON.stringify(request),
      });
      if (response.status === 409) {
        const body = (await response.json().catch(() => null)) as {
          driftedEventIds?: readonly string[];
        } | null;
        throw new ClockDriftSyncError(body?.driftedEventIds?.length ?? batch.length);
      }
      if (!response.ok) throw new Error(`push failed with status ${response.status}`);
      const parsed = parsePushResponse((await response.json()) as unknown);
      if (isProtocolError(parsed)) throw new Error(parsed.message);
      await this.deps.markAcknowledged(batch.map(row => row.eventId));
      if (batch.length < PUSH_BATCH_LIMIT) return;
    }
  }

  // The pull cursor only ever advances along pull pages. The cursor a push returns
  // is the head of the whole per-user log; jumping there would skip any events
  // another device pushed at lower sequences than our own batch.
  private async pullAll(target: SyncTarget): Promise<void> {
    let cursor = (await this.deps.loadState()).cursor;
    for (;;) {
      const response = await this.callServer(
        target,
        `/sync/pull?after=${String(cursor)}&limit=${String(PULL_DEFAULT_LIMIT)}`,
        { method: 'GET' }
      );
      if (!response.ok) throw new Error(`pull failed with status ${response.status}`);
      const parsed = parsePullResponse((await response.json()) as unknown);
      if (isProtocolError(parsed)) throw new Error(parsed.message);
      await this.deps.importRemoteEvents(parsed.events, this.deps.now());
      // A server restored from backup (or a wrong URL) can hand back a smaller
      // cursor; regressing ours would re-pull the same pages forever.
      cursor = Math.max(cursor, parsed.cursor);
      await this.deps.saveState({ cursor });
      this.publish({ cursor });
      if (!parsed.hasMore || parsed.events.length === 0) return;
    }
  }
}

export async function loadSyncConfig(): Promise<SyncConfig> {
  const record = await db.settings.get('syncConfig');
  return record?.key === 'syncConfig'
    ? { serverUrl: record.serverUrl, syncToken: record.syncToken }
    : { serverUrl: null, syncToken: null };
}

export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  await db.settings.put({
    key: 'syncConfig',
    serverUrl: config.serverUrl,
    syncToken: config.syncToken,
  });
  syncClient.noteConfigSaved(config);
}

async function loadSyncState(): Promise<SyncState> {
  const record = await db.meta.get('syncState');
  return record?.key === 'syncState'
    ? {
        cursor: record.cursor,
        lastSuccessAtMillis: record.lastSuccessAtMillis,
        driftMessage: record.driftMessage,
      }
    : { cursor: 0, lastSuccessAtMillis: null, driftMessage: null };
}

async function saveSyncState(patch: Partial<SyncState>): Promise<void> {
  const current = await loadSyncState();
  await db.meta.put({ key: 'syncState', ...current, ...patch });
}

export const syncClient = new SyncClient({
  loadConfig: () => withDatabaseRecovery(loadSyncConfig),
  loadState: () => withDatabaseRecovery(loadSyncState),
  saveState: patch => withDatabaseRecovery(() => saveSyncState(patch)),
  unacknowledgedBatch: limit => withDatabaseRecovery(() => unacknowledgedBatch(limit)),
  markAcknowledged: eventIds => withDatabaseRecovery(() => markAcknowledged(eventIds)),
  importRemoteEvents: (events, nowMillis) =>
    withDatabaseRecovery(() => importRemoteEvents(events, nowMillis)),
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  random: () => Math.random(),
  setTimer: (callback, delayMillis) => setTimeout(callback, delayMillis),
  clearTimer: handle => {
    clearTimeout(handle);
  },
});

export function getSyncStatus(): SyncStatus {
  return syncClient.getStatus();
}

export function subscribeSyncStatus(listener: StatusListener): () => void {
  return syncClient.subscribeStatus(listener);
}

export function requestSync(trigger: SyncTrigger): void {
  syncClient.requestSync(trigger);
}

let initialized = false;

// An observable error ends the subscription for good, and on iOS an IndexedDB
// read fails often enough that losing it would silently strand local appends
// until the next visibility or manual trigger. Recover the read, and re-arm the
// stream if it dies anyway.
function observePendingCount(): void {
  // Dexie re-runs the query on writes from any tab of this origin.
  liveQuery(() => withDatabaseRecovery(unacknowledgedCount)).subscribe({
    next: count => {
      syncClient.notePendingCount(count);
    },
    error: (error: unknown) => {
      console.error('pending count observation failed, re-arming', error);
      setTimeout(observePendingCount, 5_000);
    },
  });
}

export async function initSync(): Promise<void> {
  if (initialized) return;
  initialized = true;
  observePendingCount();
  window.addEventListener('online', () => {
    syncClient.requestSync('online');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncClient.requestSync('visible');
  });
  await syncClient.start();
}
