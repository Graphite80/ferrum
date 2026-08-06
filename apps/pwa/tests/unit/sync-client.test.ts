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
  config: SyncConfig = { syncToken: 'token' };
  batch: PushableEvent[] = [];
  fetchImpl: (url: string) => Promise<Response> = () => Promise.reject(new Error('network down'));
  readonly fetchCalls: string[] = [];
  readonly client: SyncClient;

  purgeQueue: string[] = [];
  readonly purgesMarkedPushed: string[] = [];
  readonly purgesAppliedLocally: string[] = [];

  private state: SyncState = {
    cursor: 0,
    purgeCursor: 0,
    lastSuccessAtMillis: null,
    driftMessage: null,
  };
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
      pendingPurges: () => Promise.resolve([...this.purgeQueue]),
      markPurgesPushed: aggregateIds => {
        this.purgesMarkedPushed.push(...aggregateIds);
        this.purgeQueue = this.purgeQueue.filter(id => !aggregateIds.includes(id));
        return Promise.resolve();
      },
      applyRemotePurges: aggregateIds => {
        this.purgesAppliedLocally.push(...aggregateIds);
        return Promise.resolve();
      },
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

  syncState(): SyncState {
    return this.state;
  }

  // A pull page that predates the purge journal, so the defaulting path is what
  // every existing gating test exercises.
  serveEmptyPull(): void {
    this.fetchImpl = url =>
      Promise.resolve(
        url.includes('/sync/purge')
          ? new Response(JSON.stringify({ purgedEvents: 0, purgeCursor: 0 }), { status: 200 })
          : new Response(JSON.stringify({ events: [], cursor: 0, hasMore: false }), { status: 200 })
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

    for (const trigger of ['visible', 'poll', 'append'] as const) {
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

  // The app has no sync control to press, so recovery cannot depend on a person.
  // `online` is the one ambient trigger that clears an armed backoff: the network
  // moving from down to up makes the failures counted so far evidence about a world
  // that no longer exists. Without this a reconnecting device waits out up to five
  // minutes for nothing, which is what a "sync now" button existed to skip.
  test('reconnecting clears the backoff and syncs at once, unlike any other ambient trigger', async () => {
    const harness = new Harness();
    harness.client.requestSync('start');
    await harness.settle();

    // Climb to a backoff long enough that waiting it out would be visible.
    for (let i = 0; i < 3; i += 1) {
      harness.fireTimer(harness.armedTimers()[0]!);
      await harness.settle();
    }
    expect(harness.armedTimers()[0]!.delayMillis).toBeGreaterThan(BACKOFF_BASE_MILLIS);
    const fetchesWhileDown = harness.fetchCalls.length;

    // Ambient nudges still respect the schedule while the server is down.
    harness.client.requestSync('visible');
    harness.client.requestSync('poll');
    await harness.settle();
    expect(harness.fetchCalls).toHaveLength(fetchesWhileDown);

    harness.serveEmptyPull();
    harness.client.requestSync('online');
    await harness.settle();
    expect(harness.fetchCalls.length).toBeGreaterThan(fetchesWhileDown);
    expect(harness.client.getStatus().lastSuccessAtMillis).toBe(harness.nowMillis);
    // A success leaves nothing armed: the schedule is gone, not merely reset.
    expect(harness.armedTimers()).toHaveLength(0);
  });

  // Drift is the device's own clock being wrong, and reconnecting says nothing
  // about that — so `online` must not cancel the hourly gate and leave the client
  // with no schedule at all.
  test('reconnecting does not disarm the drift gate', async () => {
    const harness = new Harness();
    harness.batch = [realEvent()];
    harness.serveClockDrift();
    harness.client.requestSync('start');
    await harness.settle();
    expect(harness.armedTimers()[0]!.delayMillis).toBe(DRIFT_RETRY_MILLIS);

    const fetchesAfterDrift = harness.fetchCalls.length;
    harness.client.requestSync('online');
    await harness.settle();
    expect(harness.fetchCalls).toHaveLength(fetchesAfterDrift);
    expect(harness.armedTimers()[0]!.delayMillis).toBe(DRIFT_RETRY_MILLIS);
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

  test('a pending purge schedules its own sync: no event is appended for it', async () => {
    const harness = new Harness();
    harness.serveEmptyPull();

    harness.client.notePendingPurgeCount(1);
    const timers = harness.armedTimers();
    expect(timers).toHaveLength(1);
    expect(timers[0]!.delayMillis).toBe(APPEND_DEBOUNCE_MILLIS);

    harness.client.notePendingPurgeCount(0);
    harness.fireTimer(timers[0]!);
    await harness.settle();
    expect(harness.fetchCalls).toHaveLength(1);
  });
});

describe('purge propagation', () => {
  test('a purge is delivered before the pull that would hand the workout back', async () => {
    const harness = new Harness();
    harness.purgeQueue = ['ses_erased'];
    harness.serveEmptyPull();

    harness.client.requestSync('manual');
    await harness.settle();

    expect(harness.fetchCalls[0]).toContain('/sync/purge');
    expect(harness.fetchCalls[1]).toContain('/sync/pull');
    expect(harness.purgesMarkedPushed).toEqual(['ses_erased']);
    // Drained, so the next cycle is a pull only.
    harness.client.requestSync('manual');
    await harness.settle();
    expect(harness.fetchCalls.filter(url => url.includes('/sync/purge'))).toHaveLength(1);
  });

  test('a purge from another device erases locally and advances its own cursor', async () => {
    const harness = new Harness();
    let page = 0;
    harness.fetchImpl = url => {
      if (url.includes('/sync/purge')) {
        return Promise.resolve(
          new Response(JSON.stringify({ purgedEvents: 0, purgeCursor: 0 }), { status: 200 })
        );
      }
      page += 1;
      const body =
        page === 1
          ? {
              events: [],
              cursor: 12,
              hasMore: true,
              purges: [{ aggregateId: 'ses_erased', sequence: 4 }],
              purgeCursor: 4,
            }
          : { events: [], cursor: 12, hasMore: false, purges: [], purgeCursor: 4 };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    };

    harness.client.requestSync('manual');
    await harness.settle();

    expect(harness.purgesAppliedLocally).toEqual(['ses_erased']);
    expect(harness.syncState().purgeCursor).toBe(4);
    // The second page carried nothing, so the loop stopped rather than spinning on
    // a hasMore that only the purge journal had raised.
    expect(harness.fetchCalls.filter(url => url.includes('/sync/pull'))).toHaveLength(2);
    expect(harness.fetchCalls[0]).toContain('purgedAfter=0');
    expect(harness.fetchCalls[1]).toContain('purgedAfter=4');
  });
});
