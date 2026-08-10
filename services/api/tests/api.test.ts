import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  parsePurgeResponse,
  parsePushResponse,
  serializePurgeRequest,
  serializePushRequest,
  type PullResponse,
  type PurgeResponse,
  type PushResponse,
} from '@ferrum/sync-protocol';
import { createApp } from '../src/app.ts';
import { mintTokenForUser } from '../src/auth-tokens.ts';
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
// Hoisted so a test can build a second app against the same migrated database instead
// of standing up another Postgres for one assertion.
let db: ReturnType<typeof pgliteDatabase>;
const staticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/static');

beforeAll(async () => {
  db = pgliteDatabase(new PGlite());
  await migrate(db);
  const app = createApp({
    db,
    enableDevRoutes: true,
    staticDir,
  });
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

// A second credential for an account that already exists — a second device, or
// the replacement one issues after a revocation.
async function mintFor(userId: string): Promise<string> {
  return (await mintTokenForUser(db, userId)).token;
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

async function pull(
  token: string,
  after: number,
  limit?: number,
  purgedAfter = 0
): Promise<PullResponse> {
  const query = limit === undefined ? `after=${after}` : `after=${after}&limit=${limit}`;
  const response = await fetch(`${baseUrl}/sync/pull?${query}&purgedAfter=${purgedAfter}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  const parsed = parsePullResponse(await response.json());
  if (isProtocolError(parsed)) throw new Error(parsed.message);
  return parsed;
}

async function purge(token: string, aggregateIds: readonly string[]): Promise<PurgeResponse> {
  const response = await fetch(`${baseUrl}/sync/purge`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(serializePurgeRequest({ aggregateIds })),
  });
  expect(response.status).toBe(200);
  const parsed = parsePurgeResponse(await response.json());
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
  return { ...event, userId: null, serverReceivedAt: null, serverSequence: null };
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

  // A credential on a lost phone used to be good forever. Revoking withdraws
  // every credential the account holds — the remedy has to reach the device that
  // is not in your hand, which is the whole point.
  it('withdraws every credential of the account, and only that account', async () => {
    const owner = await createToken();
    const secondDevice = await mintFor(owner.userId);
    const stranger = await createToken();

    const revoked = await fetch(`${baseUrl}/auth/revoke-all`, {
      method: 'POST',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ revoked: 2 });

    expect((await pushRaw(owner.token, '{}')).status).toBe(401);
    expect((await pushRaw(secondDevice, '{}')).status).toBe(401);
    // The sets themselves are untouched: a new credential reaches the same log.
    const reissued = await mintFor(owner.userId);
    expect((await pull(reissued, 0)).events).toBeDefined();
    expect((await pull(stranger.token, 0)).cursor).toBe(0);
  });

  it('refuses to revoke without a credential of its own', async () => {
    const response = await fetch(`${baseUrl}/auth/revoke-all`, { method: 'POST' });
    expect(response.status).toBe(401);
  });

  // Sync is a relative path against the page's own origin, so no browser ever needs
  // a preflight here. An allow header would mean the CORS middleware is back, and
  // with it the Access-Control-Request-Headers parsing behind GHSA-8j4g-w8fx-2239.
  it('grants no cross-origin access to the sync routes', async () => {
    const preflight = await fetch(`${baseUrl}/sync/push`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://attacker.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
    expect(preflight.headers.get('access-control-allow-headers')).toBeNull();

    const authed = await createToken();
    const push = await fetch(`${baseUrl}/sync/pull?after=0`, {
      headers: { authorization: `Bearer ${authed.token}`, origin: 'https://attacker.example' },
    });
    expect(push.headers.get('access-control-allow-origin')).toBeNull();
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
    expect(pushed).toEqual({ accepted: 5, duplicates: 0, purged: 0, cursor: pushed.cursor });

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

describe('purge', () => {
  it('destroys the events, journals the tombstone, and refuses to take them back', async () => {
    const { token } = await createToken();
    const events = smallSession(newBuilderState());
    await push(token, 'phone', events);
    expect((await pull(token, 0)).events).toHaveLength(5);

    const purged = await purge(token, [SESSION_ID]);
    expect(purged.purgedEvents).toBe(5);
    expect(purged.purgeCursor).toBeGreaterThan(0);

    // Gone from the log, and announced in the journal so other devices forget too.
    const afterPurge = await pull(token, 0);
    expect(afterPurge.events).toHaveLength(0);
    expect(afterPurge.purges).toEqual([{ aggregateId: SESSION_ID, sequence: purged.purgeCursor }]);
    expect(afterPurge.purgeCursor).toBe(purged.purgeCursor);

    // A device that has not seen the journal yet re-pushes what it still holds.
    // The tombstone outranks it; nothing is resurrected.
    const rePushed = await push(token, 'phone', events);
    expect(rePushed).toEqual({
      accepted: 0,
      duplicates: 0,
      purged: 5,
      cursor: rePushed.cursor,
    });
    expect((await pull(token, 0)).events).toHaveLength(0);
  });

  it('is idempotent and leaves the journal at one entry per aggregate', async () => {
    const { token } = await createToken();
    await push(token, 'phone', smallSession(newBuilderState()));

    const first = await purge(token, [SESSION_ID]);
    const second = await purge(token, [SESSION_ID, SESSION_ID]);
    expect(second.purgedEvents).toBe(0);
    expect(second.purgeCursor).toBe(first.purgeCursor);
    expect((await pull(token, 0)).purges).toHaveLength(1);
  });

  it('hands a caller that already saw the journal an empty page', async () => {
    const { token } = await createToken();
    await push(token, 'phone', smallSession(newBuilderState()));
    const purged = await purge(token, [SESSION_ID]);

    const caughtUp = await pull(token, 0, undefined, purged.purgeCursor);
    expect(caughtUp.purges).toHaveLength(0);
    expect(caughtUp.purgeCursor).toBe(purged.purgeCursor);
    expect(caughtUp.hasMore).toBe(false);
  });

  it('never reaches across users', async () => {
    const mine = await createToken();
    const theirs = await createToken();
    await push(mine.token, 'phone', smallSession(newBuilderState()));
    await push(theirs.token, 'tablet', smallSession(newBuilderState()));

    const purged = await purge(mine.token, [SESSION_ID]);
    expect(purged.purgedEvents).toBe(5);

    const untouched = await pull(theirs.token, 0);
    expect(untouched.events).toHaveLength(5);
    expect(untouched.purges).toHaveLength(0);
  });

  it('rejects a malformed request instead of destroying something adjacent', async () => {
    const { token } = await createToken();
    for (const body of ['{"aggregateIds":[]}', '{"aggregateIds":""}', 'not json']) {
      const response = await fetch(`${baseUrl}/sync/purge`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body,
      });
      expect(response.status).toBe(400);
    }

    const unauthenticated = await fetch(`${baseUrl}/sync/purge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ aggregateIds: [SESSION_ID] }),
    });
    expect(unauthenticated.status).toBe(401);
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

// A browser error nobody can see did not get fixed. The reporting path has to work for a
// client that is broken enough to have lost its session, which is why it takes no auth —
// and therefore has to refuse anything unbounded or unshaped.
describe('client error reports', () => {
  it('logs a shaped report without auth and refuses junk', async () => {
    const lines: string[] = [];
    const app = createApp({
      db,
      enableDevRoutes: false,
      log: message => lines.push(message),
    });

    const accepted = await app.request('/api/v1/client-errors', {
      method: 'POST',
      body: JSON.stringify({
        category: 'runtime',
        type: 'TypeError',
        message: 'undefined is not a function',
        appVersion: 'main-abc1234',
        route: '/workout/1',
      }),
    });
    expect(accepted.status).toBe(204);

    const entry = JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({
      src: 'client_error',
      category: 'runtime',
      message: 'undefined is not a function',
      route: '/workout/1',
    });

    const noMessage = await app.request('/api/v1/client-errors', {
      method: 'POST',
      body: JSON.stringify({ category: 'runtime' }),
    });
    expect(noMessage.status).toBe(400);

    const oversized = await app.request('/api/v1/client-errors', {
      method: 'POST',
      body: JSON.stringify({ message: 'x'.repeat(20_000) }),
    });
    expect(oversized.status).toBe(413);
  });

  // The SPA fallback answers every unknown GET with index.html. An /api path that fell
  // through to it would report success while nothing was recorded.
  it('is not shadowed by the single-page fallback', async () => {
    const app = createApp({ db, enableDevRoutes: false, staticDir });
    const response = await app.request('/api/v1/client-errors');
    expect(response.status).not.toBe(200);
  });
});

// A deploy is verified by reading the service's own logs over the QA window. That read
// is worthless if a failing request says nothing, which is what this service used to do.
describe('failure logging', () => {
  it('records API failures and stays silent for successes and assets', async () => {
    const lines: string[] = [];
    const app = createApp({
      db,
      enableDevRoutes: false,
      staticDir,
      log: message => lines.push(message),
    });

    await app.request('/health');
    await app.request('/history');
    await app.request('/sync/pull');
    await app.request('/nope', { method: 'POST' });

    const logged = lines.map(line => JSON.parse(line) as Record<string, unknown>);
    expect(logged.map(entry => entry.path)).toStrictEqual(['/sync/pull', '/nope']);
    expect(logged[0]).toMatchObject({ level: 'warn', status: 401, method: 'GET' });
    expect(typeof logged[0]?.durationMs).toBe('number');
  });

  it('answers an unhandled exception as JSON and logs it', async () => {
    const lines: string[] = [];
    const app = createApp({
      db,
      enableDevRoutes: false,
      log: message => lines.push(message),
    });
    app.get('/boom', () => {
      throw new Error('kaboom');
    });

    const response = await app.request('/boom');
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toStrictEqual({ error: 'internal_error' });

    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({ level: 'error', status: 500, error: 'kaboom' });
  });
});

describe('single-page fallback', () => {
  it('serves the app shell for an unknown document path', async () => {
    const response = await fetch(`${baseUrl}/history`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it('refuses a write to a path no route claims instead of answering with the shell', async () => {
    const response = await fetch(`${baseUrl}/nope`, { method: 'POST' });
    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({ error: 'not_found' });
  });

  // A released shell that keeps naming the previous build's bundles is the one
  // cache failure a user cannot clear their way out of, so the two halves of the
  // rule are asserted rather than assumed: hashed filenames pinned forever,
  // every mutable entry point revalidated.
  it('pins content-hashed assets and revalidates the shell', async () => {
    const asset = await fetch(`${baseUrl}/assets/app-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    for (const path of ['/', '/history']) {
      const shell = await fetch(`${baseUrl}${path}`);
      expect(shell.status).toBe(200);
      // The whole string, because the edge only honours part of it: Cloudflare's
      // aggressive level caches a bare no-cache on a cacheable extension and
      // stamps the zone's four-hour browser TTL over it; no-store is what makes
      // it actually stand aside (cf-cache-status: BYPASS).
      expect(shell.headers.get('cache-control')).toBe(
        'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
      );
    }
  });

  it('never lets an API namespace fall through to the shell', async () => {
    const wrongMethod = await fetch(`${baseUrl}/auth/bootstrap`);
    expect(wrongMethod.status).toBe(404);
    expect(wrongMethod.headers.get('content-type')).toContain('application/json');

    // The guarded namespaces answer 401 before path matching, which is stricter
    // than 404: an unauthenticated caller learns nothing about which paths exist.
    const unknownApi = await fetch(`${baseUrl}/sync/nope`);
    expect(unknownApi.status).toBe(401);
    expect(unknownApi.headers.get('content-type')).toContain('application/json');
  });
});
