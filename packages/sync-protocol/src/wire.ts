import {
  EVENT_SCHEMA_VERSION,
  buildDomainEvent,
  decodeHlc,
  encodeHlc,
  type DeviceId,
  type DomainEvent,
  type DomainEventBody,
  type DomainEventType,
  type EventId,
  type Hlc,
  type Instant,
  type SessionId,
  type UserId,
} from '@ferrum/domain';
import {
  PULL_MAX_LIMIT,
  PUSH_MAX_EVENTS,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from './protocol.ts';

const EVENT_TYPE_FLAGS: Record<DomainEventType, true> = {
  SessionStarted: true,
  SessionMetadataChanged: true,
  ExerciseAddedToSession: true,
  ExerciseRemovedFromSession: true,
  ExerciseReordered: true,
  ExerciseSubstituted: true,
  SupersetGroupChanged: true,
  SetLogged: true,
  SetAmended: true,
  SetDeleted: true,
  SetRestored: true,
  SessionFinished: true,
  SessionReopened: true,
};

export const DOMAIN_EVENT_TYPES = Object.keys(EVENT_TYPE_FLAGS) as readonly DomainEventType[];

export type ProtocolErrorCode =
  | 'not_an_object'
  | 'invalid_field'
  | 'unsupported_schema_version'
  | 'unknown_event_type'
  | 'malformed_hlc';

export interface ProtocolError {
  readonly kind: 'protocol_error';
  readonly code: ProtocolErrorCode;
  readonly path: string;
  readonly message: string;
}

export function protocolError(
  code: ProtocolErrorCode,
  path: string,
  message: string
): ProtocolError {
  return { kind: 'protocol_error', code, path, message };
}

export function isProtocolError(value: unknown): value is ProtocolError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'protocol_error'
  );
}

export interface WireEvent {
  readonly eventId: string;
  readonly aggregateId: string;
  readonly userId: string | null;
  readonly deviceId: string;
  readonly eventType: DomainEventType;
  readonly schemaVersion: number;
  readonly hlc: string;
  readonly payload: unknown;
  readonly clientCreatedAt: number;
  readonly serverReceivedAt: number | null;
  readonly serverSequence: number | null;
}

export interface WirePushRequest {
  readonly deviceId: string;
  readonly events: readonly WireEvent[];
}

export interface WirePushResponse {
  readonly accepted: number;
  readonly duplicates: number;
  readonly cursor: number;
}

export interface WirePullResponse {
  readonly events: readonly WireEvent[];
  readonly cursor: number;
  readonly hasMore: boolean;
}

export function toWireEvent(event: DomainEvent): WireEvent {
  return {
    eventId: event.eventId,
    aggregateId: event.aggregateId,
    userId: event.userId,
    deviceId: event.deviceId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    hlc: encodeHlc(event.hlc),
    payload: event.payload,
    clientCreatedAt: event.clientCreatedAt,
    serverReceivedAt: event.serverReceivedAt,
    serverSequence: event.serverSequence,
  };
}

export function serializePushRequest(request: PushRequest): WirePushRequest {
  return { deviceId: request.deviceId, events: request.events.map(toWireEvent) };
}

export function serializePushResponse(response: PushResponse): WirePushResponse {
  return { accepted: response.accepted, duplicates: response.duplicates, cursor: response.cursor };
}

export function serializePullResponse(response: PullResponse): WirePullResponse {
  return {
    events: response.events.map(toWireEvent),
    cursor: response.cursor,
    hasMore: response.hasMore,
  };
}

function asRecord(value: unknown, path: string): Record<string, unknown> | ProtocolError {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return protocolError('not_an_object', path, 'Expected a JSON object');
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, path: string): string | ProtocolError {
  if (typeof value !== 'string' || value.length === 0) {
    return protocolError('invalid_field', path, 'Expected a non-empty string');
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number | ProtocolError {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return protocolError('invalid_field', path, 'Expected a finite number');
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number | ProtocolError {
  const parsed = finiteNumber(value, path);
  if (isProtocolError(parsed)) return parsed;
  if (!Number.isInteger(parsed) || parsed < 0) {
    return protocolError('invalid_field', path, 'Expected a non-negative integer');
  }
  return parsed;
}

function parseHlcField(value: unknown, path: string): Hlc | ProtocolError {
  if (typeof value !== 'string') {
    return protocolError('malformed_hlc', path, 'Expected an encoded HLC string');
  }
  let decoded: Hlc;
  try {
    decoded = decodeHlc(value);
  } catch {
    return protocolError('malformed_hlc', path, `Malformed HLC "${value}"`);
  }
  if (!Number.isFinite(decoded.wallMillis) || !Number.isFinite(decoded.counter)) {
    return protocolError('malformed_hlc', path, `Non-hexadecimal HLC "${value}"`);
  }
  if (decoded.nodeId.length === 0 || decoded.nodeId.includes(':')) {
    return protocolError('malformed_hlc', path, `Invalid HLC node id in "${value}"`);
  }
  return decoded;
}

export function parseWireEvent(value: unknown, path = 'event'): DomainEvent | ProtocolError {
  const record = asRecord(value, path);
  if (isProtocolError(record)) return record;

  const eventId = nonEmptyString(record.eventId, `${path}.eventId`);
  if (isProtocolError(eventId)) return eventId;

  const aggregateId = nonEmptyString(record.aggregateId, `${path}.aggregateId`);
  if (isProtocolError(aggregateId)) return aggregateId;

  const deviceId = nonEmptyString(record.deviceId, `${path}.deviceId`);
  if (isProtocolError(deviceId)) return deviceId;

  if (record.userId !== null && typeof record.userId !== 'string') {
    return protocolError('invalid_field', `${path}.userId`, 'Expected a string or null');
  }

  const eventType = record.eventType;
  if (typeof eventType !== 'string' || !(eventType in EVENT_TYPE_FLAGS)) {
    return protocolError(
      'unknown_event_type',
      `${path}.eventType`,
      `Unknown event type ${JSON.stringify(eventType)}`
    );
  }

  if (record.schemaVersion !== EVENT_SCHEMA_VERSION) {
    return protocolError(
      'unsupported_schema_version',
      `${path}.schemaVersion`,
      `Expected schema version ${EVENT_SCHEMA_VERSION}`
    );
  }

  const hlc = parseHlcField(record.hlc, `${path}.hlc`);
  if (isProtocolError(hlc)) return hlc;

  const payload = asRecord(record.payload, `${path}.payload`);
  if (isProtocolError(payload)) return payload;

  const clientCreatedAt = finiteNumber(record.clientCreatedAt, `${path}.clientCreatedAt`);
  if (isProtocolError(clientCreatedAt)) return clientCreatedAt;

  const serverReceivedAt = record.serverReceivedAt ?? null;
  if (serverReceivedAt !== null && typeof serverReceivedAt !== 'number') {
    return protocolError('invalid_field', `${path}.serverReceivedAt`, 'Expected a number or null');
  }

  const serverSequence = record.serverSequence ?? null;
  if (serverSequence !== null && typeof serverSequence !== 'number') {
    return protocolError('invalid_field', `${path}.serverSequence`, 'Expected a number or null');
  }

  // The payload interior is deliberately passed through untyped: the envelope is the
  // sync contract, payload evolution is governed by schemaVersion, and the projection
  // already tolerates partial payloads field-by-field. eventType was validated against
  // EVENT_TYPE_FLAGS above, but the compiler cannot carry a runtime-proven correlation
  // between eventType and payload, so the pair is cast once here. This cast and its
  // twin in services/api/src/sync.ts rowToEvent are the only legitimate DomainEvent
  // casts in the repo — both sit at the untrusted wire boundary.
  const body = { eventType, payload } as unknown as DomainEventBody;
  return buildDomainEvent(body, {
    eventId: eventId as EventId,
    aggregateId: aggregateId as SessionId,
    userId: record.userId as UserId | null,
    deviceId: deviceId as DeviceId,
    schemaVersion: EVENT_SCHEMA_VERSION,
    hlc,
    clientCreatedAt: clientCreatedAt as Instant,
    serverReceivedAt: serverReceivedAt as Instant | null,
    serverSequence,
  });
}

export function parsePushRequest(json: unknown): PushRequest | ProtocolError {
  const record = asRecord(json, 'pushRequest');
  if (isProtocolError(record)) return record;

  const deviceId = nonEmptyString(record.deviceId, 'pushRequest.deviceId');
  if (isProtocolError(deviceId)) return deviceId;

  if (!Array.isArray(record.events)) {
    return protocolError('invalid_field', 'pushRequest.events', 'Expected an array of events');
  }
  if (record.events.length > PUSH_MAX_EVENTS) {
    return protocolError(
      'invalid_field',
      'pushRequest.events',
      `A push carries at most ${String(PUSH_MAX_EVENTS)} events`
    );
  }

  const events: DomainEvent[] = [];
  for (const [index, value] of record.events.entries()) {
    const event = parseWireEvent(value, `pushRequest.events[${index}]`);
    if (isProtocolError(event)) return event;
    events.push(event);
  }
  return { deviceId, events };
}

export function parsePushResponse(json: unknown): PushResponse | ProtocolError {
  const record = asRecord(json, 'pushResponse');
  if (isProtocolError(record)) return record;

  const accepted = nonNegativeInteger(record.accepted, 'pushResponse.accepted');
  if (isProtocolError(accepted)) return accepted;

  const duplicates = nonNegativeInteger(record.duplicates, 'pushResponse.duplicates');
  if (isProtocolError(duplicates)) return duplicates;

  const cursor = nonNegativeInteger(record.cursor, 'pushResponse.cursor');
  if (isProtocolError(cursor)) return cursor;

  return { accepted, duplicates, cursor };
}

export function parsePullRequest(json: unknown): PullRequest | ProtocolError {
  const record = asRecord(json, 'pullRequest');
  if (isProtocolError(record)) return record;

  const afterSequence = nonNegativeInteger(record.afterSequence, 'pullRequest.afterSequence');
  if (isProtocolError(afterSequence)) return afterSequence;

  const limit = nonNegativeInteger(record.limit, 'pullRequest.limit');
  if (isProtocolError(limit)) return limit;
  if (limit < 1 || limit > PULL_MAX_LIMIT) {
    return protocolError(
      'invalid_field',
      'pullRequest.limit',
      `Expected a limit between 1 and ${PULL_MAX_LIMIT}`
    );
  }

  return { afterSequence, limit };
}

export function parsePullResponse(json: unknown): PullResponse | ProtocolError {
  const record = asRecord(json, 'pullResponse');
  if (isProtocolError(record)) return record;

  if (!Array.isArray(record.events)) {
    return protocolError('invalid_field', 'pullResponse.events', 'Expected an array of events');
  }

  const events: DomainEvent[] = [];
  for (const [index, value] of record.events.entries()) {
    const event = parseWireEvent(value, `pullResponse.events[${index}]`);
    if (isProtocolError(event)) return event;
    events.push(event);
  }

  const cursor = nonNegativeInteger(record.cursor, 'pullResponse.cursor');
  if (isProtocolError(cursor)) return cursor;

  if (typeof record.hasMore !== 'boolean') {
    return protocolError('invalid_field', 'pullResponse.hasMore', 'Expected a boolean');
  }

  return { events, cursor, hasMore: record.hasMore };
}
