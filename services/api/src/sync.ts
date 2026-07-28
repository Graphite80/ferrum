import { and, eq, gt, sql } from 'drizzle-orm';
import {
  ClockDriftError,
  buildDomainEvent,
  decodeHlc,
  encodeHlc,
  instant,
  receive,
  type DomainEvent,
  type DomainEventBody,
  type Hlc,
  type UserId,
} from '@ferrum/domain';
import {
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from '@ferrum/sync-protocol';
import { type Database, type Tx } from './db.ts';
import { deviceClocks, events } from './schema.ts';

export class ClockDriftBatchError extends Error {
  constructor(readonly driftedEventIds: readonly string[]) {
    super(`Clock drift beyond tolerance on ${driftedEventIds.length} event(s)`);
    this.name = 'ClockDriftBatchError';
  }
}

// The server participates in the HLC protocol as one node per user, so its node id
// must be stable, unique per user, and free of the ':' separator used by encodeHlc.
function serverNodeId(userId: string): string {
  return `srv-${userId.replaceAll('-', '').slice(0, 8)}`;
}

export async function pushBatch(
  tx: Tx,
  userId: string,
  request: PushRequest,
  nowMillis: number
): Promise<PushResponse> {
  const uid = userId as UserId;
  const nodeId = serverNodeId(userId);
  // SET LOCAL scopes to this transaction, so it survives PgBouncer transaction
  // pooling; a wedged push must not hold the device_clocks lock forever.
  await tx.execute(sql`set local statement_timeout = '30s'`);
  await tx.execute(sql`set local idle_in_transaction_session_timeout = '60s'`);
  await tx
    .insert(deviceClocks)
    .values({ userId, deviceId: nodeId, wallMillis: 0, counter: 0 })
    .onConflictDoNothing({ target: [deviceClocks.userId, deviceClocks.deviceId] });
  const locked = await tx
    .select({ wallMillis: deviceClocks.wallMillis, counter: deviceClocks.counter })
    .from(deviceClocks)
    .where(and(eq(deviceClocks.userId, userId), eq(deviceClocks.deviceId, nodeId)))
    .for('update');
  const lockedRow = locked[0];
  if (lockedRow === undefined) {
    throw new Error('device_clocks row vanished inside the transaction');
  }

  let clock: Hlc = {
    wallMillis: lockedRow.wallMillis,
    counter: lockedRow.counter,
    nodeId,
  };

  const drifted: string[] = [];
  for (const event of request.events) {
    try {
      clock = receive(clock, event.hlc, nowMillis);
    } catch (error) {
      if (error instanceof ClockDriftError) drifted.push(event.eventId);
      else throw error;
    }
  }
  if (drifted.length > 0) throw new ClockDriftBatchError(drifted);

  let accepted = 0;
  let duplicates = 0;
  for (const event of request.events) {
    const inserted = await tx
      .insert(events)
      .values({
        userId: uid,
        eventId: event.eventId,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        schemaVersion: event.schemaVersion,
        hlc: encodeHlc(event.hlc),
        deviceId: event.deviceId,
        payload: event.payload,
        clientCreatedAt: new Date(event.clientCreatedAt),
      })
      .onConflictDoNothing({ target: [events.userId, events.eventId] })
      .returning({ serverSequence: events.serverSequence });
    if (inserted.length > 0) accepted += 1;
    else duplicates += 1;
  }

  await tx
    .update(deviceClocks)
    .set({ wallMillis: clock.wallMillis, counter: clock.counter })
    .where(and(eq(deviceClocks.userId, userId), eq(deviceClocks.deviceId, nodeId)));

  const cursorResult = await tx
    .select({ cursor: sql`coalesce(max(${events.serverSequence}), 0)`.mapWith(Number) })
    .from(events)
    .where(eq(events.userId, uid));
  return { accepted, duplicates, cursor: cursorResult[0]?.cursor ?? 0 };
}

export const USER_EVENTS_HARD_CAP = 100_000;

export class EventLogTooLargeError extends Error {
  constructor(readonly cap: number) {
    super(`Event log exceeds ${String(cap)} events`);
    this.name = 'EventLogTooLargeError';
  }
}

export async function loadUserEvents(
  db: Database,
  userId: string,
  cap: number = USER_EVENTS_HARD_CAP
): Promise<readonly DomainEvent[]> {
  const rows = await db.orm
    .select()
    .from(events)
    .where(eq(events.userId, userId as UserId))
    .orderBy(events.serverSequence)
    .limit(cap + 1);
  if (rows.length > cap) {
    throw new EventLogTooLargeError(cap);
  }
  return rows.map(rowToEvent);
}

export async function pullPage(
  db: Database,
  userId: string,
  request: PullRequest
): Promise<PullResponse> {
  const rows = await db.orm
    .select()
    .from(events)
    .where(
      and(eq(events.userId, userId as UserId), gt(events.serverSequence, request.afterSequence))
    )
    .orderBy(events.serverSequence)
    .limit(request.limit + 1);
  const hasMore = rows.length > request.limit;
  const page = rows.slice(0, request.limit);
  const pageEvents = page.map(rowToEvent);
  const last = page[page.length - 1];
  const cursor = last === undefined ? request.afterSequence : last.serverSequence;
  return { events: pageEvents, cursor, hasMore };
}

function rowToEvent(row: typeof events.$inferSelect): DomainEvent {
  // Every stored row went through parseWireEvent before insert, so event_type is a
  // known DomainEventType — but the compiler cannot carry that runtime-proven
  // correlation between eventType and payload back out of the database, so the pair
  // is cast once here. This cast and its twin in packages/sync-protocol/src/wire.ts
  // parseWireEvent are the only legitimate DomainEvent casts in the repo — both sit
  // at the untrusted wire boundary.
  const body = {
    eventType: row.eventType,
    payload: row.payload,
  } as unknown as DomainEventBody;
  return buildDomainEvent(body, {
    eventId: row.eventId,
    aggregateId: row.aggregateId,
    userId: row.userId,
    deviceId: row.deviceId,
    schemaVersion: row.schemaVersion,
    hlc: decodeHlc(row.hlc),
    clientCreatedAt: instant(row.clientCreatedAt.getTime()),
    serverReceivedAt: instant(row.serverReceivedAt.getTime()),
    serverSequence: row.serverSequence,
  });
}
