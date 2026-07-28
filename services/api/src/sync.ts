import {
  ClockDriftError,
  buildDomainEvent,
  decodeHlc,
  encodeHlc,
  instant,
  receive,
  type DeviceId,
  type DomainEvent,
  type DomainEventBody,
  type EventId,
  type Hlc,
  type SessionId,
  type UserId,
} from '@ferrum/domain';
import {
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from '@ferrum/sync-protocol';
import { type QueryResultRow, type QueryRunner } from './db.ts';

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
  tx: QueryRunner,
  userId: string,
  request: PushRequest,
  nowMillis: number
): Promise<PushResponse> {
  const nodeId = serverNodeId(userId);
  // SET LOCAL scopes to this transaction, so it survives PgBouncer transaction
  // pooling; a wedged push must not hold the device_clocks lock forever.
  await tx.exec("set local statement_timeout = '30s'");
  await tx.exec("set local idle_in_transaction_session_timeout = '60s'");
  await tx.query(
    `insert into device_clocks (user_id, device_id, wall_millis, counter)
     values ($1, $2, 0, 0)
     on conflict (user_id, device_id) do nothing`,
    [userId, nodeId]
  );
  const locked = await tx.query(
    `select wall_millis, counter from device_clocks
     where user_id = $1 and device_id = $2
     for update`,
    [userId, nodeId]
  );
  const lockedRow = locked.rows[0];
  if (lockedRow === undefined) {
    throw new Error('device_clocks row vanished inside the transaction');
  }

  let clock: Hlc = {
    wallMillis: Number(lockedRow.wall_millis),
    counter: Number(lockedRow.counter),
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
    const inserted = await tx.query(
      `insert into events
         (user_id, event_id, aggregate_id, event_type, schema_version, hlc, device_id, payload, client_created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9::double precision / 1000.0))
       on conflict (user_id, event_id) do nothing
       returning server_sequence`,
      [
        userId,
        event.eventId,
        event.aggregateId,
        event.eventType,
        event.schemaVersion,
        encodeHlc(event.hlc),
        event.deviceId,
        JSON.stringify(event.payload),
        event.clientCreatedAt,
      ]
    );
    if (inserted.rows.length > 0) accepted += 1;
    else duplicates += 1;
  }

  await tx.query(
    'update device_clocks set wall_millis = $3, counter = $4 where user_id = $1 and device_id = $2',
    [userId, nodeId, clock.wallMillis, clock.counter]
  );

  const cursorResult = await tx.query(
    'select coalesce(max(server_sequence), 0) as cursor from events where user_id = $1',
    [userId]
  );
  return { accepted, duplicates, cursor: Number(cursorResult.rows[0]?.cursor) };
}

const EVENT_COLUMNS = `event_id, aggregate_id, user_id, device_id, event_type, schema_version, hlc, payload,
            (extract(epoch from client_created_at) * 1000)::bigint as client_created_at_millis,
            (extract(epoch from server_received_at) * 1000)::bigint as server_received_at_millis,
            server_sequence`;

export const USER_EVENTS_HARD_CAP = 100_000;

export class EventLogTooLargeError extends Error {
  constructor(readonly cap: number) {
    super(`Event log exceeds ${String(cap)} events`);
    this.name = 'EventLogTooLargeError';
  }
}

export async function loadUserEvents(
  db: QueryRunner,
  userId: string,
  cap: number = USER_EVENTS_HARD_CAP
): Promise<readonly DomainEvent[]> {
  const result = await db.query(
    `select ${EVENT_COLUMNS}
     from events
     where user_id = $1
     order by server_sequence
     limit $2`,
    [userId, cap + 1]
  );
  if (result.rows.length > cap) {
    throw new EventLogTooLargeError(cap);
  }
  return result.rows.map(rowToEvent);
}

export async function pullPage(
  db: QueryRunner,
  userId: string,
  request: PullRequest
): Promise<PullResponse> {
  const result = await db.query(
    `select ${EVENT_COLUMNS}
     from events
     where user_id = $1 and server_sequence > $2
     order by server_sequence
     limit $3`,
    [userId, request.afterSequence, request.limit + 1]
  );
  const hasMore = result.rows.length > request.limit;
  const page = result.rows.slice(0, request.limit);
  const events = page.map(rowToEvent);
  const last = page[page.length - 1];
  const cursor = last === undefined ? request.afterSequence : Number(last.server_sequence);
  return { events, cursor, hasMore };
}

function rowToEvent(row: QueryResultRow): DomainEvent {
  // Every stored row went through parseWireEvent before insert, so event_type is a
  // known DomainEventType — but the compiler cannot carry that runtime-proven
  // correlation between eventType and payload back out of the database, so the pair
  // is cast once here. This cast and its twin in packages/sync-protocol/src/wire.ts
  // parseWireEvent are the only legitimate DomainEvent casts in the repo — both sit
  // at the untrusted wire boundary.
  const body = {
    eventType: String(row.event_type),
    payload: row.payload,
  } as unknown as DomainEventBody;
  return buildDomainEvent(body, {
    eventId: String(row.event_id) as EventId,
    aggregateId: String(row.aggregate_id) as SessionId,
    userId: String(row.user_id) as UserId,
    deviceId: String(row.device_id) as DeviceId,
    schemaVersion: Number(row.schema_version),
    hlc: decodeHlc(String(row.hlc)),
    clientCreatedAt: instant(Number(row.client_created_at_millis)),
    serverReceivedAt: instant(Number(row.server_received_at_millis)),
    serverSequence: Number(row.server_sequence),
  });
}
