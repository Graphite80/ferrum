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
  subscribe,
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

const PUSH_BATCH_LIMIT = 500;
const APPEND_DEBOUNCE_MILLIS = 2_000;
const BACKOFF_BASE_MILLIS = 5_000;
const BACKOFF_CAP_MILLIS = 300_000;
const DRIFT_RETRY_MILLIS = 3_600_000;
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

const statusListeners = new Set<StatusListener>();

let status: SyncStatus = {
  configured: false,
  syncing: false,
  pendingCount: 0,
  cursor: 0,
  lastSuccessAtMillis: null,
  lastError: null,
  driftMessage: null,
};

let initialized = false;
let cycleInFlight = false;
let rerunRequested = false;
let failureCount = 0;
let lastDriftAtMillis = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let appendTimer: ReturnType<typeof setTimeout> | null = null;

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSyncStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function publish(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of statusListeners) listener(status);
}

export async function loadSyncConfig(): Promise<SyncConfig> {
  const record = await db.settings.get('settings');
  return {
    serverUrl: record?.syncServerUrl ?? null,
    syncToken: record?.syncToken ?? null,
  };
}

export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const existing = await db.settings.get('settings');
    await db.settings.put({
      key: 'settings',
      unit: existing?.unit ?? 'kg',
      ...(config.serverUrl === null ? {} : { syncServerUrl: config.serverUrl }),
      ...(config.syncToken === null ? {} : { syncToken: config.syncToken }),
    });
  });
  publish({
    configured: config.serverUrl !== null && config.syncToken !== null,
    lastError: null,
  });
}

interface SyncState {
  readonly cursor: number;
  readonly lastSuccessAtMillis: number | null;
  readonly driftMessage: string | null;
}

async function loadSyncState(): Promise<SyncState> {
  const record = await db.meta.get('syncState');
  return {
    cursor: record?.cursor ?? 0,
    lastSuccessAtMillis: record?.lastSuccessAtMillis ?? null,
    driftMessage: record?.driftMessage ?? null,
  };
}

async function saveSyncState(patch: Partial<SyncState>): Promise<void> {
  const current = await loadSyncState();
  await db.meta.put({ key: 'syncState', ...current, ...patch });
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '');
}

async function callServer(
  config: { serverUrl: string; syncToken: string },
  path: string,
  init: { method: 'GET' } | { method: 'POST'; body: string }
): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${config.syncToken}` };
  if (init.method === 'POST') headers['content-type'] = 'application/json';
  return fetch(`${normalizeServerUrl(config.serverUrl)}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLIS),
  });
}

async function pushAll(config: { serverUrl: string; syncToken: string }): Promise<void> {
  for (;;) {
    const batch = await withDatabaseRecovery(() => unacknowledgedBatch(PUSH_BATCH_LIMIT));
    const first = batch[0];
    if (first === undefined) return;
    const request = serializePushRequest({
      deviceId: first.envelope.deviceId,
      events: batch.map(row => row.envelope),
    });
    const response = await callServer(config, '/sync/push', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    if (response.status === 409) throw new ClockDriftSyncError(batch.length);
    if (!response.ok) throw new Error(`push failed with status ${response.status}`);
    const parsed = parsePushResponse((await response.json()) as unknown);
    if (isProtocolError(parsed)) throw new Error(parsed.message);
    await withDatabaseRecovery(() => markAcknowledged(batch.map(row => row.eventId)));
    publish({ pendingCount: await unacknowledgedCount() });
    if (batch.length < PUSH_BATCH_LIMIT) return;
  }
}

// The pull cursor only ever advances along pull pages. The cursor a push returns is
// the head of the whole per-user log; jumping there would skip any events another
// device pushed at lower sequences than our own batch.
async function pullAll(config: { serverUrl: string; syncToken: string }): Promise<void> {
  let cursor = (await loadSyncState()).cursor;
  for (;;) {
    const response = await callServer(
      config,
      `/sync/pull?after=${String(cursor)}&limit=${String(PULL_DEFAULT_LIMIT)}`,
      { method: 'GET' }
    );
    if (!response.ok) throw new Error(`pull failed with status ${response.status}`);
    const parsed = parsePullResponse((await response.json()) as unknown);
    if (isProtocolError(parsed)) throw new Error(parsed.message);
    await withDatabaseRecovery(() => importRemoteEvents(parsed.events));
    cursor = parsed.cursor;
    await saveSyncState({ cursor });
    publish({ cursor });
    if (!parsed.hasMore) return;
  }
}

function scheduleRetry(delayMillis: number): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    requestSync('retry');
  }, delayMillis);
}

async function runCycle(): Promise<void> {
  const config = await loadSyncConfig();
  if (config.serverUrl === null || config.syncToken === null) {
    publish({ configured: false, syncing: false });
    return;
  }
  const target = { serverUrl: config.serverUrl, syncToken: config.syncToken };
  publish({ configured: true, syncing: true });
  try {
    await pushAll(target);
    await pullAll(target);
    failureCount = 0;
    const now = Date.now();
    await saveSyncState({ lastSuccessAtMillis: now, driftMessage: null });
    publish({
      syncing: false,
      lastSuccessAtMillis: now,
      lastError: null,
      driftMessage: null,
      pendingCount: await unacknowledgedCount(),
    });
  } catch (error) {
    const pendingCount = await unacknowledgedCount().catch(() => status.pendingCount);
    if (error instanceof ClockDriftSyncError) {
      lastDriftAtMillis = Date.now();
      await saveSyncState({ driftMessage: error.message });
      publish({ syncing: false, driftMessage: error.message, lastError: null, pendingCount });
      scheduleRetry(DRIFT_RETRY_MILLIS);
      return;
    }
    failureCount += 1;
    const message = error instanceof Error ? error.message : String(error);
    publish({ syncing: false, lastError: message, pendingCount });
    scheduleRetry(Math.min(BACKOFF_BASE_MILLIS * 2 ** (failureCount - 1), BACKOFF_CAP_MILLIS));
  }
}

export function requestSync(trigger: SyncTrigger): void {
  if (cycleInFlight) {
    rerunRequested = true;
    return;
  }
  const driftGateActive =
    status.driftMessage !== null &&
    trigger !== 'manual' &&
    trigger !== 'retry' &&
    Date.now() - lastDriftAtMillis < DRIFT_RETRY_MILLIS;
  if (driftGateActive) return;
  if (trigger === 'manual' && retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
    failureCount = 0;
  }
  cycleInFlight = true;
  void runCycle().finally(() => {
    cycleInFlight = false;
    if (rerunRequested) {
      rerunRequested = false;
      requestSync('coalesced');
    }
  });
}

function scheduleAppendSync(): void {
  if (appendTimer !== null) clearTimeout(appendTimer);
  appendTimer = setTimeout(() => {
    appendTimer = null;
    requestSync('append');
  }, APPEND_DEBOUNCE_MILLIS);
}

export async function initSync(): Promise<void> {
  if (initialized) return;
  initialized = true;
  const [state, config, pendingCount] = await Promise.all([
    loadSyncState(),
    loadSyncConfig(),
    unacknowledgedCount(),
  ]);
  publish({
    configured: config.serverUrl !== null && config.syncToken !== null,
    cursor: state.cursor,
    lastSuccessAtMillis: state.lastSuccessAtMillis,
    driftMessage: state.driftMessage,
    pendingCount,
  });
  subscribe(scheduleAppendSync);
  window.addEventListener('online', () => {
    requestSync('online');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestSync('visible');
  });
  requestSync('start');
}
