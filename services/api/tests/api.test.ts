import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { PGlite } from '@electric-sql/pglite';
import fc from 'fast-check';
import {
  instant,
  localDate,
  projectSession,
  type DomainEvent,
  type ExerciseDefinitionId,
  type SessionExerciseId,
  type WorkoutSetId,
} from '@ferrum/domain';
import {
  isProtocolError,
  parsePullResponse,
  parsePushResponse,
  serializePushRequest,
  type PullResponse,
  type PushResponse,
} from '@ferrum/sync-protocol';
import { createApp } from '../src/app.ts';
import { migrate } from '../src/migrate.ts';
import { pgliteDatabase } from '../src/pglite-database.ts';
import {
  makeEvent,
  measurements,
  newBuilderState,
  qualifiers,
  scriptedSessionArbitrary,
  signature,
  SESSION_ID,
  type EventBuilderState,
} from '@ferrum/domain/testing';

let server: ServerType;
let baseUrl = '';

beforeAll(async () => {
  const db = pgliteDatabase(new PGlite());
  await migrate(db);
  const app = createApp({ db, enableDevRoutes: true });
  await new Promise<void>(resolve => {
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, info => {
      baseUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

async function createToken(): Promise<{ userId: string; token: string }> {
  const response = await fetch(`${baseUrl}/dev/token`, { method: 'POST' });
  expect(response.status).toBe(200);
  return (await response.json()) as { userId: string; token: string };
}

async function pushRaw(token: string | null, body: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}/sync/push`, { method: 'POST', headers, body });
}

async function push(
  token: string,
  deviceId: string,
  events: readonly DomainEvent[]
): Promise<PushResponse> {
  const response = await pushRaw(token, JSON.stringify(serializePushRequest({ deviceId, events })));
  expect(response.status).toBe(200);
  const parsed = parsePushResponse(await response.json());
  if (isProtocolError(parsed)) throw new Error(parsed.message);
  return parsed;
}

async function pull(token: string, after: number, limit?: number): Promise<PullResponse> {
  const query = limit === undefined ? `after=${after}` : `after=${after}&limit=${limit}`;
  const response = await fetch(`${baseUrl}/sync/pull?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  const parsed = parsePullResponse(await response.json());
  if (isProtocolError(parsed)) throw new Error(parsed.message);
  return parsed;
}

async function pullAll(token: string, limit = 10): Promise<DomainEvent[]> {
  const events: DomainEvent[] = [];
  let after = 0;
  for (;;) {
    const page = await pull(token, after, limit);
    events.push(...page.events);
    if (!page.hasMore) return events;
    after = page.cursor;
  }
}

function smallSession(state: EventBuilderState, wallStart = 1_000_000): DomainEvent[] {
  const exerciseId = 'ex-001' as SessionExerciseId;
  const setId = 'set-001' as WorkoutSetId;
  return [
    makeEvent(state, 'phone', wallStart, 'SessionStarted', {
      sessionId: SESSION_ID,
      startedAt: instant(wallStart),
      localDate: localDate('2026-07-20'),
      tzOffsetMinutes: 120,
      title: 'push day',
    }),
    makeEvent(state, 'phone', wallStart + 1, 'ExerciseAddedToSession', {
      sessionExerciseId: exerciseId,
      sessionId: SESSION_ID,
      exerciseDefinitionId: 'def-1' as ExerciseDefinitionId,
      equipmentInstanceId: null,
      orderIndex: 0,
      supersetGroupId: null,
      supersetOrder: null,
    }),
    makeEvent(state, 'phone', wallStart + 2, 'SetLogged', {
      setId,
      sessionExerciseId: exerciseId,
      orderIndex: 0,
      setType: 'working',
      measurements: measurements(60, 8),
      qualifiers: qualifiers(),
      equipmentInstanceId: null,
      bodyweightKgSnapshot: null,
      bodyweightSource: null,
      bodyweightAgeDays: null,
      prescriptionSnapshot: null,
      exerciseRevisionSnapshot: 1,
      comparisonSignature: signature(exerciseId),
      provenance: null,
      performedAt: instant(wallStart + 2),
      localDate: localDate('2026-07-20'),
      tzOffsetMinutes: 120,
    }),
    makeEvent(state, 'phone', wallStart + 3, 'SetAmended', {
      setId,
      measurements: { reps: 9 },
    }),
    makeEvent(state, 'phone', wallStart + 4, 'SessionFinished', {
      sessionId: SESSION_ID,
      finishedAt: instant(wallStart + 4),
    }),
  ];
}

function domainView(event: DomainEvent): DomainEvent {
  return { ...event, userId: null, serverReceivedAt: null, serverSequence: null } as DomainEvent;
}

describe('health', () => {
  it('answers without auth', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('auth', () => {
  it('rejects sync routes without a token', async () => {
    const pushResponse = await pushRaw(null, '{}');
    expect(pushResponse.status).toBe(401);
    const pullResponse = await fetch(`${baseUrl}/sync/pull?after=0`);
    expect(pullResponse.status).toBe(401);
  });

  it('rejects an unknown token', async () => {
    const response = await pushRaw('no-such-token', '{}');
    expect(response.status).toBe(401);
  });

  it('keeps users isolated from each other', async () => {
    const alice = await createToken();
    const bob = await createToken();
    await push(alice.token, 'phone', smallSession(newBuilderState()));
    const bobView = await pull(bob.token, 0);
    expect(bobView.events).toHaveLength(0);
    expect(bobView.cursor).toBe(0);
    expect(bobView.hasMore).toBe(false);
  });
});

describe('push validation', () => {
  it('rejects malformed json with 400', async () => {
    const { token } = await createToken();
    const response = await pushRaw(token, 'not json');
    expect(response.status).toBe(400);
  });

  it('returns the protocol error for an invalid envelope', async () => {
    const { token } = await createToken();
    const response = await pushRaw(token, JSON.stringify({ deviceId: 'phone', events: [{}] }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { kind: string };
    expect(body.kind).toBe('protocol_error');
  });
});

describe('push and pull', () => {
  it('round-trips every domain field byte-equal and fills in server fields', async () => {
    const { userId, token } = await createToken();
    const events = smallSession(newBuilderState());
    const pushed = await push(token, 'phone', events);
    expect(pushed).toEqual({ accepted: 5, duplicates: 0, cursor: pushed.cursor });

    const pulled = await pull(token, 0);
    expect(pulled.hasMore).toBe(false);
    expect(pulled.cursor).toBe(pushed.cursor);
    expect(pulled.events.map(domainView)).toEqual(events.map(domainView));
    for (const event of pulled.events) {
      expect(event.userId).toBe(userId);
      expect(event.serverReceivedAt).not.toBeNull();
      expect(event.serverSequence).not.toBeNull();
    }
  });

  it('is idempotent on double push: duplicates counted, no new sequences', async () => {
    const { token } = await createToken();
    const events = smallSession(newBuilderState());
    const first = await push(token, 'phone', events);
    expect(first.accepted).toBe(5);
    expect(first.duplicates).toBe(0);

    const second = await push(token, 'phone', events);
    expect(second.accepted).toBe(0);
    expect(second.duplicates).toBe(5);
    expect(second.cursor).toBe(first.cursor);

    const pulled = await pull(token, 0);
    expect(pulled.events).toHaveLength(5);
    expect(pulled.events.map(event => event.serverSequence)).toEqual(
      [...pulled.events.map(event => event.serverSequence)].sort((a, b) => Number(a) - Number(b))
    );
  });

  it('paginates with the cursor until hasMore is false', async () => {
    const { token } = await createToken();
    const events = smallSession(newBuilderState());
    await push(token, 'phone', events);

    const firstPage = await pull(token, 0, 2);
    expect(firstPage.events).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);

    const secondPage = await pull(token, firstPage.cursor, 2);
    expect(secondPage.events).toHaveLength(2);
    expect(secondPage.hasMore).toBe(true);

    const thirdPage = await pull(token, secondPage.cursor, 2);
    expect(thirdPage.events).toHaveLength(1);
    expect(thirdPage.hasMore).toBe(false);

    const stitched = [...firstPage.events, ...secondPage.events, ...thirdPage.events];
    expect(stitched.map(domainView)).toEqual(events.map(domainView));
  });

  it('serves multi-device interleaved batches in server_sequence order', async () => {
    const { token } = await createToken();
    const state = newBuilderState();
    const phoneFirst = smallSession(state).slice(0, 2);
    const tabletBatch = [
      makeEvent(state, 'tablet', 1_000_010, 'SessionMetadataChanged', {
        sessionId: SESSION_ID,
        note: 'from the tablet',
      }),
    ];
    const phoneSecond = [
      makeEvent(state, 'phone', 1_000_020, 'SessionReopened', { sessionId: SESSION_ID }),
    ];

    await push(token, 'phone', phoneFirst);
    await push(token, 'tablet', tabletBatch);
    await push(token, 'phone', phoneSecond);

    const pulled = await pull(token, 0);
    const sequences = pulled.events.map(event => Number(event.serverSequence));
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(pulled.events.map(event => event.eventId)).toEqual(
      [...phoneFirst, ...tabletBatch, ...phoneSecond].map(event => event.eventId)
    );
    expect(new Set(pulled.events.map(event => event.deviceId))).toEqual(
      new Set(['phone', 'tablet'])
    );
  });

  it('rejects a batch containing an event from a drifted clock with a typed 409', async () => {
    const { token } = await createToken();
    const state = newBuilderState();
    const valid = smallSession(state).slice(0, 1);
    const drifted = makeEvent(state, 'phone', Date.now() + 600_000, 'SessionReopened', {
      sessionId: SESSION_ID,
    });

    const response = await pushRaw(
      token,
      JSON.stringify(serializePushRequest({ deviceId: 'phone', events: [...valid, drifted] }))
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'clock_drift',
      driftedEventIds: [drifted.eventId],
    });

    const pulled = await pull(token, 0);
    expect(pulled.events).toHaveLength(0);
  });
});

describe('replay on the server output', () => {
  it('projects identically from pulled events and from the original input', async () => {
    const { token } = await createToken();
    const sample = fc.sample(scriptedSessionArbitrary, { seed: 4242, numRuns: 1 })[0];
    if (sample === undefined) throw new Error('generator produced no session');

    for (let offset = 0; offset < sample.events.length; offset += 25) {
      await push(token, 'phone', sample.events.slice(offset, offset + 25));
    }

    const pulled = await pullAll(token);
    expect(pulled).toHaveLength(sample.events.length);
    expect(projectSession(SESSION_ID, pulled)).toEqual(projectSession(SESSION_ID, sample.events));
  });
});
