import {
  ClockDriftError,
  buildDomainEvent,
  type DeviceId,
  type DomainEvent,
  type DomainEventPayloadMap,
  type DomainEventType,
  type EventId,
  type SessionId,
  type SessionProjection,
  EVENT_SCHEMA_VERSION,
  eventOrderKey,
  instant,
  projectSession,
  receive,
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

  return db.transaction('rw', db.events, db.device, async () => {
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
      envelopes.push(
        buildDomainEvent(input, {
          eventId: ulidFactory.next(nowMillis) as EventId,
          aggregateId: input.aggregateId,
          userId: null,
          deviceId: record.deviceId as DeviceId,
          schemaVersion: EVENT_SCHEMA_VERSION,
          hlc: clock,
          clientCreatedAt: instant(nowMillis),
          serverReceivedAt: null,
          serverSequence: null,
        })
      );
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
}

export async function unacknowledgedBatch(limit: number): Promise<StoredEvent[]> {
  return db.events
    .where('[acknowledged+orderKey]')
    .between([0, ''], [1, ''], true, false)
    .limit(limit)
    .toArray();
}

export async function markAcknowledged(eventIds: readonly string[]): Promise<void> {
  if (eventIds.length === 0) return;
  await db.transaction('rw', db.events, async () => {
    await db.events.where('eventId').anyOf(eventIds).modify({ acknowledged: 1 });
  });
}

// Foreign events already carry their envelopes — HLC, device id, event id — and
// re-stamping any of it would fork the total order between replicas. They land
// acknowledged: the server is where they came from. The local clock must fold
// in every imported HLC: an edit stamped by a device whose clock trails a
// remote event would otherwise sort before the set it amends — on every
// replica, permanently.
export async function importRemoteEvents(
  envelopes: readonly DomainEvent[],
  nowMillis: number
): Promise<number> {
  if (envelopes.length === 0) return 0;
  const fresh = await db.transaction('rw', db.events, db.device, db.purges, async () => {
    // A purge this device requested but has not delivered yet still has its events
    // on the server; importing them back would undo the deletion on every sync
    // until the request lands.
    const purged = new Set(
      (
        await db.purges
          .where('aggregateId')
          .anyOf([...new Set(envelopes.map(envelope => envelope.aggregateId))])
          .toArray()
      ).map(record => record.aggregateId)
    );
    const admissible =
      purged.size === 0
        ? envelopes
        : envelopes.filter(envelope => !purged.has(envelope.aggregateId));
    const existing = await db.events.bulkGet(admissible.map(envelope => envelope.eventId));
    const unseen = admissible.filter((_, index) => existing[index] === undefined);
    await db.events.bulkAdd(
      unseen.map(envelope => ({
        eventId: envelope.eventId,
        aggregateId: envelope.aggregateId,
        orderKey: eventOrderKey(envelope),
        acknowledged: 1 as const,
        envelope,
      }))
    );

    if (unseen.length > 0) {
      const record = (await db.device.get('device')) ?? {
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
      for (const envelope of unseen) {
        try {
          clock = receive(clock, envelope.hlc, nowMillis);
        } catch (error) {
          if (!(error instanceof ClockDriftError)) throw error;
          console.error('remote event clock too far ahead, not folding', envelope.eventId, error);
        }
      }
      await db.device.put({
        key: 'device',
        deviceId: record.deviceId,
        hlcWallMillis: clock.wallMillis,
        hlcCounter: clock.counter,
      });
    }
    return unseen;
  });
  return fresh.length;
}

// Purge is the only path that removes training data instead of tombstoning it
// (INVARIANTS §7), so it takes everything the session owns in one transaction and
// leaves a local tombstone behind to keep sync from re-importing it.
async function purge(
  aggregateIds: readonly string[],
  nowMillis: number,
  pushed: 0 | 1
): Promise<void> {
  if (aggregateIds.length === 0) return;
  await db.transaction(
    'rw',
    db.events,
    db.purges,
    db.sessionPlans,
    db.restTimers,
    db.snapshots,
    async () => {
      await db.purges.bulkPut(
        aggregateIds.map(aggregateId => ({
          aggregateId,
          requestedAtMillis: nowMillis,
          pushed,
        }))
      );
      await db.events
        .where('aggregateId')
        .anyOf([...aggregateIds])
        .delete();
      await db.sessionPlans.bulkDelete([...aggregateIds]);
      await db.restTimers.bulkDelete([...aggregateIds]);
      await db.snapshots.bulkDelete([...aggregateIds]);
    }
  );
}

export async function purgeSession(sessionId: SessionId, nowMillis: number): Promise<void> {
  await purge([sessionId], nowMillis, 0);
}

export async function applyRemotePurges(
  aggregateIds: readonly string[],
  nowMillis: number
): Promise<void> {
  await purge(aggregateIds, nowMillis, 1);
}

export async function pendingPurges(limit: number): Promise<string[]> {
  const rows = await db.purges.where('pushed').equals(0).limit(limit).toArray();
  return rows.map(row => row.aggregateId);
}

export async function pendingPurgeCount(): Promise<number> {
  return db.purges.where('pushed').equals(0).count();
}

export async function markPurgesPushed(aggregateIds: readonly string[]): Promise<void> {
  if (aggregateIds.length === 0) return;
  await db.transaction('rw', db.purges, async () => {
    await db.purges
      .where('aggregateId')
      .anyOf([...aggregateIds])
      .modify({ pushed: 1 });
  });
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

export async function listSessions(): Promise<SessionProjection[]> {
  const sessionIds = await listSessionIds();
  return Promise.all(sessionIds.map(sessionId => loadSession(sessionId)));
}

export async function unacknowledgedCount(): Promise<number> {
  return db.events.where('acknowledged').equals(0).count();
}

export async function getDeviceId(): Promise<string> {
  const record = await db.device.get('device');
  return record?.deviceId ?? '(not yet assigned)';
}
