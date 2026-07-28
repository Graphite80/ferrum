import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { encodeHlc, instant, localDate, sortEvents, type DomainEvent } from '@ferrum/domain';
import {
  DOMAIN_EVENT_TYPES,
  isProtocolError,
  mergeEventLogs,
  parsePullRequest,
  parsePullResponse,
  parsePushRequest,
  parsePushResponse,
  parseWireEvent,
  serializePullResponse,
  serializePushRequest,
  serializePushResponse,
  toWireEvent,
  type PushRequest,
} from '../src/index.ts';
import {
  makeEvent,
  newBuilderState,
  scriptedSessionArbitrary,
  SESSION_ID,
} from '../../domain/tests/support/factories.ts';

function overWire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function sampleEvents(): DomainEvent[] {
  const state = newBuilderState();
  return [
    makeEvent(state, 'phone', 1_000_000, 'SessionStarted', {
      sessionId: SESSION_ID,
      startedAt: instant(1_000_000),
      localDate: localDate('2026-07-20'),
      tzOffsetMinutes: 120,
      title: null,
    }),
    makeEvent(state, 'tablet', 1_000_001, 'SessionReopened', { sessionId: SESSION_ID }),
  ];
}

describe('wire round-trip', () => {
  it('push request survives serialize -> JSON -> parse for every generated session', () => {
    fc.assert(
      fc.property(scriptedSessionArbitrary, session => {
        const request: PushRequest = { deviceId: 'phone', events: session.events };
        const parsed = parsePushRequest(overWire(serializePushRequest(request)));
        expect(isProtocolError(parsed)).toBe(false);
        expect(parsed).toEqual(request);
      }),
      { numRuns: 50 }
    );
  });

  it('parse -> serialize is the identity on the wire form', () => {
    fc.assert(
      fc.property(scriptedSessionArbitrary, session => {
        const wire = serializePushRequest({ deviceId: 'tablet', events: session.events });
        const parsed = parsePushRequest(overWire(wire));
        if (isProtocolError(parsed)) throw new Error(parsed.message);
        expect(overWire(serializePushRequest(parsed))).toEqual(overWire(wire));
      }),
      { numRuns: 50 }
    );
  });

  it('pull response round-trips including cursor and hasMore', () => {
    const events = sortEvents(sampleEvents());
    const response = { events, cursor: 42, hasMore: true };
    const parsed = parsePullResponse(overWire(serializePullResponse(response)));
    expect(parsed).toEqual(response);
  });

  it('push response round-trips', () => {
    const response = { accepted: 3, duplicates: 2, cursor: 17 };
    expect(parsePushResponse(overWire(serializePushResponse(response)))).toEqual(response);
  });

  it('covers all 13 event types', () => {
    expect(DOMAIN_EVENT_TYPES).toHaveLength(13);
  });
});

describe('malformed input rejection', () => {
  const validEvent = () => toWireEvent(sampleEvents()[0] as DomainEvent);

  it.each([null, undefined, 42, 'push', []])('rejects non-object request %#', value => {
    const result = parsePushRequest(value);
    expect(isProtocolError(result)).toBe(true);
    if (isProtocolError(result)) expect(result.code).toBe('not_an_object');
  });

  it('rejects an empty deviceId', () => {
    const result = parsePushRequest({ deviceId: '', events: [] });
    expect(isProtocolError(result)).toBe(true);
  });

  it('rejects events that are not an array', () => {
    const result = parsePushRequest({ deviceId: 'phone', events: {} });
    expect(isProtocolError(result)).toBe(true);
  });

  it('rejects an unknown event type', () => {
    const result = parseWireEvent({ ...validEvent(), eventType: 'SetExploded' });
    expect(isProtocolError(result)).toBe(true);
    if (isProtocolError(result)) expect(result.code).toBe('unknown_event_type');
  });

  it('rejects a foreign schema version', () => {
    const result = parseWireEvent({ ...validEvent(), schemaVersion: 2 });
    expect(isProtocolError(result)).toBe(true);
    if (isProtocolError(result)) expect(result.code).toBe('unsupported_schema_version');
  });

  it.each([
    'garbage',
    'zzzzzzzzzzzz:0000:phone',
    '000000000000:zzzz:phone',
    '000000000000:0000:',
    '000000000000:0000:a:b',
    '00000000:00:phone',
    12345,
    null,
  ])('rejects malformed hlc %#', hlc => {
    const result = parseWireEvent({ ...validEvent(), hlc });
    expect(isProtocolError(result)).toBe(true);
    if (isProtocolError(result)) expect(result.code).toBe('malformed_hlc');
  });

  it.each(['eventId', 'aggregateId', 'deviceId'])('rejects missing %s', key => {
    const event: Record<string, unknown> = { ...validEvent() };
    delete event[key];
    expect(isProtocolError(parseWireEvent(event))).toBe(true);
  });

  it('rejects a non-object payload', () => {
    expect(isProtocolError(parseWireEvent({ ...validEvent(), payload: 42 }))).toBe(true);
  });

  it('rejects a non-numeric clientCreatedAt', () => {
    const result = parseWireEvent({ ...validEvent(), clientCreatedAt: 'yesterday' });
    expect(isProtocolError(result)).toBe(true);
  });

  it('reports the failing event index in the path', () => {
    const result = parsePushRequest({
      deviceId: 'phone',
      events: [validEvent(), { ...validEvent(), schemaVersion: 9 }],
    });
    expect(isProtocolError(result)).toBe(true);
    if (isProtocolError(result)) expect(result.path).toContain('events[1]');
  });

  it('rejects pull requests with out-of-range limits', () => {
    expect(isProtocolError(parsePullRequest({ afterSequence: 0, limit: 0 }))).toBe(true);
    expect(isProtocolError(parsePullRequest({ afterSequence: 0, limit: 1001 }))).toBe(true);
    expect(isProtocolError(parsePullRequest({ afterSequence: -1, limit: 10 }))).toBe(true);
    expect(parsePullRequest({ afterSequence: 0, limit: 10 })).toEqual({
      afterSequence: 0,
      limit: 10,
    });
  });
});

describe('mergeEventLogs', () => {
  it('dedupes and totally orders the union of two logs', () => {
    fc.assert(
      fc.property(scriptedSessionArbitrary, session => {
        const mid = Math.floor(session.events.length / 2);
        const local = session.events.slice(0, mid + 2);
        const remote = session.events.slice(mid);
        const merged = mergeEventLogs(local, remote);
        expect(merged).toEqual(sortEvents(session.events));
        expect(new Set(merged.map(event => event.eventId)).size).toBe(merged.length);
      }),
      { numRuns: 30 }
    );
  });
});

describe('hlc encoding on the wire', () => {
  it('carries the exact encoded hlc string', () => {
    const [event] = sampleEvents();
    if (event === undefined) throw new Error('sample missing');
    expect(toWireEvent(event).hlc).toBe(encodeHlc(event.hlc));
  });
});
