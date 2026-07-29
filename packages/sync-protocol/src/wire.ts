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
  array,
  boolean,
  custom,
  integer,
  literal,
  maxLength,
  maxValue,
  minLength,
  minValue,
  nullable,
  number,
  object,
  optional,
  picklist,
  pipe,
  rawTransform,
  safeParse,
  string,
  transform,
  type BaseIssue,
  type GenericSchema,
} from 'valibot';
import {
  PULL_MAX_LIMIT,
  PURGE_MAX_AGGREGATES,
  PUSH_MAX_EVENTS,
  type PullRequest,
  type PullResponse,
  type PurgeRequest,
  type PurgeResponse,
  type PurgedAggregate,
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
  SessionDeleted: true,
  SessionRestored: true,
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
  readonly purged: number;
  readonly cursor: number;
}

export interface WirePullResponse {
  readonly events: readonly WireEvent[];
  readonly cursor: number;
  readonly hasMore: boolean;
  readonly purges: readonly PurgedAggregate[];
  readonly purgeCursor: number;
}

export interface WirePurgeRequest {
  readonly aggregateIds: readonly string[];
}

export interface WirePurgeResponse {
  readonly purgedEvents: number;
  readonly purgeCursor: number;
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
  return {
    accepted: response.accepted,
    duplicates: response.duplicates,
    purged: response.purged,
    cursor: response.cursor,
  };
}

export function serializePullResponse(response: PullResponse): WirePullResponse {
  return {
    events: response.events.map(toWireEvent),
    cursor: response.cursor,
    hasMore: response.hasMore,
    purges: response.purges.map(purge => ({ ...purge })),
    purgeCursor: response.purgeCursor,
  };
}

export function serializePurgeRequest(request: PurgeRequest): WirePurgeRequest {
  return { aggregateIds: [...request.aggregateIds] };
}

export function serializePurgeResponse(response: PurgeResponse): WirePurgeResponse {
  return { purgedEvents: response.purgedEvents, purgeCursor: response.purgeCursor };
}

const NOT_AN_OBJECT_MESSAGE = 'Expected a JSON object';

function isJsonRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

const nonEmptyStringSchema = pipe(
  string('Expected a non-empty string'),
  minLength(1, 'Expected a non-empty string')
);

const finiteNumberSchema = number('Expected a finite number');

const nonNegativeIntegerSchema = pipe(
  finiteNumberSchema,
  integer('Expected a non-negative integer'),
  minValue(0, 'Expected a non-negative integer')
);

// HLC validation stays hand-rolled on purpose: decodeHlc owns the 12:4:nodeId width
// contract, and a regex would silently drift from it.
const hlcSchema = pipe(
  string('Expected an encoded HLC string'),
  rawTransform(({ dataset, addIssue, NEVER }): Hlc => {
    let decoded: Hlc;
    try {
      decoded = decodeHlc(dataset.value);
    } catch {
      addIssue({ message: `Malformed HLC "${dataset.value}"` });
      return NEVER;
    }
    if (!Number.isFinite(decoded.wallMillis) || !Number.isFinite(decoded.counter)) {
      addIssue({ message: `Non-hexadecimal HLC "${dataset.value}"` });
      return NEVER;
    }
    if (decoded.nodeId.length === 0 || decoded.nodeId.includes(':')) {
      addIssue({ message: `Invalid HLC node id in "${dataset.value}"` });
      return NEVER;
    }
    return decoded;
  })
);

const payloadSchema = custom<Record<string, unknown>>(isJsonRecord, NOT_AN_OBJECT_MESSAGE);

const wireEventSchema = pipe(
  object({
    eventId: nonEmptyStringSchema,
    aggregateId: nonEmptyStringSchema,
    deviceId: nonEmptyStringSchema,
    userId: nullable(string('Expected a string or null')),
    eventType: picklist(
      DOMAIN_EVENT_TYPES,
      issue => `Unknown event type ${JSON.stringify(issue.input)}`
    ),
    schemaVersion: literal(EVENT_SCHEMA_VERSION, `Expected schema version ${EVENT_SCHEMA_VERSION}`),
    hlc: hlcSchema,
    payload: payloadSchema,
    clientCreatedAt: finiteNumberSchema,
    serverReceivedAt: optional(nullable(number('Expected a number or null')), null),
    serverSequence: optional(nullable(number('Expected a number or null')), null),
  }),
  transform((record): DomainEvent => {
    // The payload interior is deliberately passed through untyped: the envelope is the
    // sync contract, payload evolution is governed by schemaVersion, and the projection
    // already tolerates partial payloads field-by-field. eventType was validated against
    // DOMAIN_EVENT_TYPES above, but the compiler cannot carry a runtime-proven correlation
    // between eventType and payload, so the pair is cast once here. This cast and its
    // twin in services/api/src/sync.ts rowToEvent are the only legitimate DomainEvent
    // casts in the repo — both sit at the untrusted wire boundary.
    const body = {
      eventType: record.eventType,
      payload: record.payload,
    } as unknown as DomainEventBody;
    return buildDomainEvent(body, {
      eventId: record.eventId as EventId,
      aggregateId: record.aggregateId as SessionId,
      userId: record.userId as UserId | null,
      deviceId: record.deviceId as DeviceId,
      schemaVersion: EVENT_SCHEMA_VERSION,
      hlc: record.hlc,
      clientCreatedAt: record.clientCreatedAt as Instant,
      serverReceivedAt: record.serverReceivedAt as Instant | null,
      serverSequence: record.serverSequence,
    });
  })
);

const pushRequestSchema = object({
  deviceId: nonEmptyStringSchema,
  events: pipe(
    array(wireEventSchema, 'Expected an array of events'),
    maxLength(PUSH_MAX_EVENTS, `A push carries at most ${PUSH_MAX_EVENTS} events`)
  ),
});

const pushResponseSchema = object({
  accepted: nonNegativeIntegerSchema,
  duplicates: nonNegativeIntegerSchema,
  purged: optional(nonNegativeIntegerSchema, 0),
  cursor: nonNegativeIntegerSchema,
});

const pullRequestSchema = object({
  afterSequence: nonNegativeIntegerSchema,
  limit: pipe(
    nonNegativeIntegerSchema,
    minValue(1, `Expected a limit between 1 and ${PULL_MAX_LIMIT}`),
    maxValue(PULL_MAX_LIMIT, `Expected a limit between 1 and ${PULL_MAX_LIMIT}`)
  ),
  afterPurgeSequence: optional(nonNegativeIntegerSchema, 0),
});

const purgedAggregateSchema = object({
  aggregateId: nonEmptyStringSchema,
  sequence: nonNegativeIntegerSchema,
});

// A server that predates the purge journal answers without these two fields, and a
// client that treated that as a protocol error would stall its whole sync over a
// feature it is not using. They default instead: no journal means nothing purged.
const pullResponseSchema = object({
  events: array(wireEventSchema, 'Expected an array of events'),
  cursor: nonNegativeIntegerSchema,
  hasMore: boolean('Expected a boolean'),
  purges: optional(array(purgedAggregateSchema, 'Expected an array of purges'), []),
  purgeCursor: optional(nonNegativeIntegerSchema, 0),
});

const purgeRequestSchema = object({
  aggregateIds: pipe(
    array(nonEmptyStringSchema, 'Expected an array of aggregate ids'),
    minLength(1, 'Expected at least one aggregate id'),
    maxLength(PURGE_MAX_AGGREGATES, `A purge carries at most ${PURGE_MAX_AGGREGATES} aggregate ids`)
  ),
});

const purgeResponseSchema = object({
  purgedEvents: nonNegativeIntegerSchema,
  purgeCursor: nonNegativeIntegerSchema,
});

function pathSegment(key: unknown): string {
  if (typeof key === 'number') return `[${key}]`;
  if (typeof key === 'string') return `.${key}`;
  return '.?';
}

function toProtocolError(issue: BaseIssue<unknown>, rootPath: string): ProtocolError {
  const items = issue.path ?? [];
  const path = rootPath + items.map(item => pathSegment(item.key)).join('');
  const lastKey = items.at(-1)?.key;
  // `custom` only ever guards payload records, so both branches mean "not a JSON object".
  const notAnObject = issue.expected === 'Object' || issue.type === 'custom';
  const code: ProtocolErrorCode =
    lastKey === 'hlc'
      ? 'malformed_hlc'
      : lastKey === 'eventType'
        ? 'unknown_event_type'
        : lastKey === 'schemaVersion'
          ? 'unsupported_schema_version'
          : notAnObject
            ? 'not_an_object'
            : 'invalid_field';
  return protocolError(code, path, notAnObject ? NOT_AN_OBJECT_MESSAGE : issue.message);
}

function parseWith<TOutput>(
  schema: GenericSchema<unknown, TOutput>,
  input: unknown,
  rootPath: string
): TOutput | ProtocolError {
  if (!isJsonRecord(input)) {
    return protocolError('not_an_object', rootPath, NOT_AN_OBJECT_MESSAGE);
  }
  const result = safeParse(schema, input, { abortEarly: true });
  if (result.success) return result.output;
  return toProtocolError(result.issues[0], rootPath);
}

export function parseWireEvent(value: unknown, path = 'event'): DomainEvent | ProtocolError {
  return parseWith(wireEventSchema, value, path);
}

export function parsePushRequest(json: unknown): PushRequest | ProtocolError {
  return parseWith(pushRequestSchema, json, 'pushRequest');
}

export function parsePushResponse(json: unknown): PushResponse | ProtocolError {
  return parseWith(pushResponseSchema, json, 'pushResponse');
}

export function parsePullRequest(json: unknown): PullRequest | ProtocolError {
  return parseWith(pullRequestSchema, json, 'pullRequest');
}

export function parsePullResponse(json: unknown): PullResponse | ProtocolError {
  return parseWith(pullResponseSchema, json, 'pullResponse');
}

export function parsePurgeRequest(json: unknown): PurgeRequest | ProtocolError {
  return parseWith(purgeRequestSchema, json, 'purgeRequest');
}

export function parsePurgeResponse(json: unknown): PurgeResponse | ProtocolError {
  return parseWith(purgeResponseSchema, json, 'purgeResponse');
}
