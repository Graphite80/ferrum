import { describe, expect, test } from 'vitest';
import { instant, localDate } from '@ferrum/domain';
import { makeEvent, newBuilderState, SESSION_ID } from '@ferrum/domain/testing';
import {
  APPEND_DEBOUNCE_MILLIS,
  BACKOFF_BASE_MILLIS,
  BACKOFF_CAP_MILLIS,
  DRIFT_RETRY_MILLIS,
  SyncClient,
  type PushableEvent,
  type SyncClientDeps,
  type SyncConfig,
  type SyncState,
  type TimerHandle,
} from '../../src/sync/sync-client.ts';

interface ArmedTimer {
  readonly id: number;
  readonly callback: () => void;
  readonly delayMillis: number;
}

class Harness {
  nowMillis = 1_000_000;
  randomValue = 1;
  config: SyncConfig = { serverUrl: 'https://sync.example', syncToken: 'token' };
  batch: PushableEvent[] = [];
  fetchImpl: (url: string) => Promise<Response> = () => Promise.reject(new Error('network down'));
  readonly fetchCalls: string[] = [];
  readonly client: SyncClient;

  private state: SyncState = { cursor: 0, lastSuccessAtMillis: null, driftMessage: null };
  private timers = new Map<number, ArmedTimer>();
  private nextTimerId = 1;

  constructor() {
    const deps: SyncClientDeps = {
      loadConfig: () => Promise.resolve(this.config),
      loadState: () => Promise.resolve(this.state),
      saveState: patch => {
        this.state = { ...this.state, ...patch };
        return Promise.resolve();
      },
      unacknowledgedBatch: () => Promise.resolve([...this.batch]),
      markAcknowledged: () => Promise.resolve(),
      importRemoteEvents: () => Promise.resolve(0),
      fetch: url => {
        this.fetchCalls.push(url);
        return this.fetchImpl(url);
      },
      now: () => this.nowMillis,
      random: () => this.randomValue,
      setTimer: (callback, delayMillis) => {
        const id = this.nextTimerId;
        this.nextTimerId += 1;
        this.timers.set(id, { id, callback, delayMillis });
        return id as unknown as TimerHandle;
      },
      clearTimer: handle => {
        this.timers.delete(handle as unknown as number);
      },
    };
    this.client = new SyncClient(deps);
  }

  armedTimers(): ArmedTimer[] {
    return [...this.timers.values()];
  }

  fireTimer(timer: ArmedTimer): void {
    this.timers.delete(timer.id);
    timer.callback();
  }

  async settle(): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
    }
  }

  serveEmptyPull(): void {
    this.fetchImpl = () =>
      Promise.resolve(
        new Response(JSON.stringify({ events: [], cursor: 0, hasMore: false }), { status: 200 })
      );
  }

  serveClockDrift(): void {
    this.fetchImpl = () =>
      Promise.resolve(
        new Response(JSON.stringify({ driftedEventIds: ['evt-000001'] }), { status: 409 })
      );
  }
}

function realEvent(): PushableEvent {
  const envelope = makeEvent(newBuilderState(), 'phone', 1_000, 'SessionStarted', {
    sessionId: SESSION_ID,
    startedAt: instant(1_000),
    localDate: localDate('2026-07-20'),
    tzOffsetMinutes: 120,
    title: null,
  });
  return { eventId: envelope.eventId, envelope };
}

describe('sync gating logic', () => {
  test('failures back off exponentially with jitter inside [0.5, 1.0], capped', async () => {
    const harness = new Harness();
    harness.client.requestSync('start');
    await harness.settle();

    const expectedFull = [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000];
    const observed: number[] = [];
    for (const expected of expectedFull) {
      const timers = harness.armedTimers();
      expect(timers).toHaveLength(1);
      const timer = timers[0]!;
      observed.push(timer.delayMillis);
      expect(timer.delayMillis).toBe(expected * (0.5 + harness.randomValue * 0.5));
      harness.fireTimer(timer);
      await harness.settle();
    }
    expect(observed.at(-1)).toBe(BACKOFF_CAP_MILLIS);
    expect(observed[0]).toBe(BACKOFF_BASE_MILLIS);

    // The jitter floor: random() === 0 halves the delay, never more.
    const jittered = new Harness();
    jittered.randomValue = 0;
    jittered.client.requestSync('start');
    await jittered.settle();
    expect(jittered.armedTimers()[0]!.delayMillis).toBe(BACKOFF_BASE_MILLIS / 2);
  });

  test('an armed backoff suppresses ambient triggers; manual clears it and resets the schedule', async () => {
    const harness = new Harness();
    harness.client.requestSync('start');
    await harness.settle();
    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.armedTimers()).toHaveLength(1);

    for (const trigger of ['online', 'visible', 'append'] as const) {
      harness.client.requestSync(trigger);
      await harness.settle();
    }
    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.armedTimers()).toHaveLength(1);

    harness.client.requestSync('manual');
    await harness.settle();
    expect(harness.fetchCalls).toHaveLength(2);
    // failureCount was reset by manual, so the re-armed backoff is back at base.
    expect(harness.armedTimers()[0]!.delayMillis).toBe(BACKOFF_BASE_MILLIS);
  });

  test('clock drift arms the hourly gate: ambient triggers stay quiet, manual still syncs', async () => {
    const harness = new Harness();
    harness.batch = [realEvent()];
    harness.serveClockDrift();
    harness.client.requestSync('start');
    await harness.settle();

    expect(harness.client.getStatus().driftMessage).toContain('clock is too far');
    expect(harness.client.getStatus().lastError).toBeNull();
    const [driftTimer] = harness.armedTimers();
    expect(driftTimer!.delayMillis).toBe(DRIFT_RETRY_MILLIS);
    const fetchesAfterDrift = harness.fetchCalls.length;

    harness.nowMillis += DRIFT_RETRY_MILLIS - 1;
    harness.client.requestSync('visible');
    await harness.settle();
    expect(harness.fetchCalls).toHaveLength(fetchesAfterDrift);

    harness.batch = [];
    harness.serveEmptyPull();
    harness.client.requestSync('manual');
    await harness.settle();
    expect(harness.fetchCalls.length).toBeGreaterThan(fetchesAfterDrift);
    expect(harness.client.getStatus().driftMessage).toBeNull();
    expect(harness.client.getStatus().lastSuccessAtMillis).toBe(harness.nowMillis);
  });

  test('triggers during an in-flight cycle coalesce into exactly one follow-up cycle', async () => {
    const harness = new Harness();
    let releasePull: (() => void) | null = null;
    harness.fetchImpl = () =>
      new Promise<Response>(resolve => {
        releasePull = () => {
          resolve(
            new Response(JSON.stringify({ events: [], cursor: 0, hasMore: false }), {
              status: 200,
            })
          );
        };
      });

    harness.client.requestSync('manual');
    await harness.settle();
    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.client.getStatus().syncing).toBe(true);

    harness.client.requestSync('online');
    harness.client.requestSync('append');
    harness.client.requestSync('visible');
    await harness.settle();
    expect(harness.fetchCalls).toHaveLength(1);

    harness.serveEmptyPull();
    releasePull!();
    await harness.settle();
    // One coalesced re-run, not one per queued trigger.
    expect(harness.fetchCalls).toHaveLength(2);
    expect(harness.client.getStatus().syncing).toBe(false);
  });

  test('any pending work schedules one debounced append sync', async () => {
    const harness = new Harness();
    harness.serveEmptyPull();

    harness.client.notePendingCount(3);
    expect(harness.client.getStatus().pendingCount).toBe(3);

    // Dexie collapses an append that lands mid-recount into one emission, so a
    // count that did not rise still means unsynced local work.
    harness.client.notePendingCount(2);
    harness.client.notePendingCount(5);
    const timers = harness.armedTimers();
    expect(timers).toHaveLength(1);
    expect(timers[0]!.delayMillis).toBe(APPEND_DEBOUNCE_MILLIS);

    harness.fireTimer(timers[0]!);
    await harness.settle();
    expect(harness.fetchCalls).toHaveLength(1);

    // Nothing pending is the only state that schedules nothing.
    harness.client.notePendingCount(0);
    expect(harness.armedTimers()).toHaveLength(0);
  });
});
