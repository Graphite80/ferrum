import {
  type DomainEvent,
  type DomainEventPayloadMap,
  type DomainEventType,
  type SessionId,
  type SessionProjection,
  EVENT_SCHEMA_VERSION,
  eventOrderKey,
  instant,
  projectSession,
  tick,
} from '@ferrum/domain';
import { db, type StoredEvent } from './ferrum-db.ts';
import { newDeviceId, ulidFactory } from '../platform/ids.ts';

export type AppendInput = {
  [T in DomainEventType]: {
    readonly aggregateId: SessionId;
    readonly eventType: T;
    readonly payload: DomainEventPayloadMap[T];
  };
}[DomainEventType];

export type StoreListener = (aggregateId: SessionId) => void;

const listeners = new Set<StoreListener>();

export function subscribe(listener: StoreListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Every append is one short read-write transaction that commits before the caller
// is told the set was logged. WebKit bug 202705 makes an in-flight IDBTransaction
// stop being active when the process is suspended, so a transaction held open
// across taps is a transaction that can vanish when the user switches apps
// mid-workout. Nothing here awaits anything outside the transaction.
export async function appendEvents(
  inputs: readonly AppendInput[],
  nowMillis: number
): Promise<DomainEvent[]> {
  if (inputs.length === 0) return [];

  const written = await db.transaction('rw', db.events, db.device, async () => {
    const existing = await db.device.get('device');
    const record = existing ?? {
      key: 'device' as const,
      deviceId: newDeviceId(),
      hlcWallMillis: 0,
      hlcCounter: 0,
    };

    let clock = {
      wallMillis: record.hlcWallMillis,
      counter: record.hlcCounter,
      nodeId: record.deviceId,
    };

    const envelopes: DomainEvent[] = [];
    for (const input of inputs) {
      clock = tick(clock, nowMillis);
      // AppendInput is a distributed union, so every call site is checked for a
      // payload that matches its eventType. TypeScript cannot carry that correlation
      // through a loop over the union, which is the only reason this cast exists.
      const envelope = {
        eventId: ulidFactory.next(nowMillis),
        aggregateId: input.aggregateId,
        userId: null,
        deviceId: record.deviceId,
        eventType: input.eventType,
        schemaVersion: EVENT_SCHEMA_VERSION,
        hlc: clock,
        payload: input.payload,
        clientCreatedAt: instant(nowMillis),
        serverReceivedAt: null,
        serverSequence: null,
      } as unknown as DomainEvent;
      envelopes.push(envelope);
    }

    const rows: StoredEvent[] = envelopes.map(envelope => ({
      eventId: envelope.eventId,
      aggregateId: envelope.aggregateId,
      orderKey: eventOrderKey(envelope),
      acknowledged: 0,
      envelope,
    }));

    await db.events.bulkAdd(rows);
    await db.device.put({
      key: 'device',
      deviceId: record.deviceId,
      hlcWallMillis: clock.wallMillis,
      hlcCounter: clock.counter,
    });

    return envelopes;
  });

  const first = written[0];
  if (first !== undefined) {
    for (const listener of listeners) listener(first.aggregateId);
  }
  return written;
}

export async function unacknowledgedBatch(limit: number): Promise<StoredEvent[]> {
  const rows = await db.events.where('acknowledged').equals(0).toArray();
  rows.sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0));
  return rows.slice(0, limit);
}

export async function markAcknowledged(eventIds: readonly string[]): Promise<void> {
  if (eventIds.length === 0) return;
  await db.transaction('rw', db.events, async () => {
    await db.events.where('eventId').anyOf(eventIds).modify({ acknowledged: 1 });
  });
}

// Foreign events already carry their envelopes — HLC, device id, event id — and
// re-stamping any of it would fork the total order between replicas. They land
// acknowledged: the server is where they came from.
export async function importRemoteEvents(envelopes: readonly DomainEvent[]): Promise<number> {
  if (envelopes.length === 0) return 0;
  const fresh = await db.transaction('rw', db.events, async () => {
    const existing = await db.events.bulkGet(envelopes.map(envelope => envelope.eventId));
    const unseen = envelopes.filter((_, index) => existing[index] === undefined);
    await db.events.bulkAdd(
      unseen.map(envelope => ({
        eventId: envelope.eventId,
        aggregateId: envelope.aggregateId,
        orderKey: eventOrderKey(envelope),
        acknowledged: 1 as const,
        envelope,
      }))
    );
    return unseen;
  });
  const aggregateIds = new Set(fresh.map(envelope => envelope.aggregateId));
  for (const aggregateId of aggregateIds) {
    for (const listener of listeners) listener(aggregateId);
  }
  return fresh.length;
}

export async function loadSession(sessionId: SessionId): Promise<SessionProjection> {
  const rows = await db.events.where('aggregateId').equals(sessionId).toArray();
  return projectSession(
    sessionId,
    rows.map(row => row.envelope)
  );
}

export async function listSessionIds(): Promise<SessionId[]> {
  const rows = await db.events.where('acknowledged').anyOf(0, 1).toArray();
  const byId = new Map<SessionId, string>();
  for (const row of rows) {
    const current = byId.get(row.aggregateId as SessionId);
    if (current === undefined || row.orderKey < current) {
      byId.set(row.aggregateId as SessionId, row.orderKey);
    }
  }
  return [...byId.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(([sessionId]) => sessionId);
}

export async function unacknowledgedCount(): Promise<number> {
  return db.events.where('acknowledged').equals(0).count();
}

export async function getDeviceId(): Promise<string> {
  const record = await db.device.get('device');
  return record?.deviceId ?? '(not yet assigned)';
}
