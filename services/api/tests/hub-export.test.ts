import { createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  instant,
  localDate,
  type ExerciseDefinitionId,
  type SessionExerciseId,
  type WorkoutSetId,
} from '@ferrum/domain';
import { serializePushRequest } from '@ferrum/sync-protocol';
import { type DomainEvent } from '@ferrum/domain';
import {
  makeEvent,
  measurements,
  newBuilderState,
  qualifiers,
  signature,
  SESSION_ID,
} from '@ferrum/domain/testing';
import { createApp } from '../src/app.ts';
import { migrate } from '../src/migrate.ts';
import { pgliteDatabase } from '../src/pglite-database.ts';
import { mintTokenForUser } from '../src/auth-tokens.ts';
import { findOrCreateUserByIdentity } from '../src/identities.ts';
import { SSO_PROVIDER } from '../src/sso.ts';

// The return leg: a workout logged here has to arrive at the hub, or the hub
// goes stale the moment a lifter stops using the importer that used to feed it.

const SIGNING_KEY = 'a-shared-signing-key-of-adequate-length';

interface Received {
  readonly authorization: string;
  readonly body: { sets: readonly Record<string, unknown>[] };
}

const received: Received[] = [];

let hub: ServerType;
let hubUrl = '';
let server: ServerType;
let baseUrl = '';
let db: ReturnType<typeof pgliteDatabase>;
let token = '';

beforeAll(async () => {
  hub = await new Promise<ServerType>(resolve => {
    const started = serve(
      {
        port: 0,
        hostname: '127.0.0.1',
        fetch: async (request: Request) => {
          received.push({
            authorization: request.headers.get('authorization') ?? '',
            body: (await request.json()) as Received['body'],
          });
          return new Response(JSON.stringify({ received: 0, created: 0, updated: 0 }), {
            headers: { 'content-type': 'application/json' },
          });
        },
      },
      info => {
        hubUrl = `http://127.0.0.1:${String(info.port)}`;
        resolve(started);
      }
    );
  });

  db = pgliteDatabase(new PGlite());
  await migrate(db);
  const userId = await findOrCreateUserByIdentity(db, SSO_PROVIDER, '7');
  token = (await mintTokenForUser(db, userId)).token;

  const app = createApp({
    db,
    enableDevRoutes: false,
    ssoSigningKey: SIGNING_KEY,
    hubApiUrl: hubUrl,
  });
  server = await new Promise<ServerType>(resolve => {
    const started = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, info => {
      baseUrl = `http://127.0.0.1:${String(info.port)}`;
      resolve(started);
    });
  });
});

afterAll(() => {
  server.close();
  hub.close();
});

function workout(finished: boolean, wallStart: number) {
  const state = newBuilderState();
  const exerciseId = 'ex-1' as SessionExerciseId;
  const setId = 'set-1' as WorkoutSetId;
  const built: DomainEvent[] = [
    makeEvent(state, 'phone', wallStart, 'SessionStarted', {
      sessionId: SESSION_ID,
      startedAt: instant(wallStart),
      localDate: localDate('2026-07-30'),
      tzOffsetMinutes: 120,
      title: 'push day',
    }),
    makeEvent(state, 'phone', wallStart + 1, 'ExerciseAddedToSession', {
      sessionExerciseId: exerciseId,
      sessionId: SESSION_ID,
      exerciseDefinitionId: 'bench_press_barbell' as ExerciseDefinitionId,
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
      measurements: measurements(80, 8),
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
      localDate: localDate('2026-07-30'),
      tzOffsetMinutes: 120,
    }),
  ];
  if (finished) {
    built.push(
      makeEvent(state, 'phone', wallStart + 3, 'SessionFinished', {
        sessionId: SESSION_ID,
        finishedAt: instant(wallStart + 3),
      })
    );
  }
  return built;
}

async function push(events: ReturnType<typeof workout>) {
  const response = await fetch(`${baseUrl}/sync/push`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(serializePushRequest({ deviceId: 'phone', events })),
  });
  expect(response.status).toBe(200);
}

describe('pushing a workout on to the hub', () => {
  it('sends nothing while the workout is still being logged', async () => {
    received.length = 0;
    await push(workout(false, 1_000_000));
    // A session mid-log would arrive at the hub a set at a time and read there
    // as a string of tiny workouts.
    expect(received).toHaveLength(0);
  });

  it('sends the finished workout in the shape the hub keys on', async () => {
    received.length = 0;
    await push(workout(true, 1_000_000));
    expect(received).toHaveLength(1);

    const sets = received[0]!.body.sets;
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({
      date: '2026-07-30',
      exercise: 'Bench Press (Barbell)',
      set_index: 0,
      weight_kg: 80,
      reps: 8,
      set_type: 'normal',
    });
  });

  it('presents a write ticket, not the read one a browser holds', () => {
    const ticket = received[0]!.authorization.replace(/^Bearer /, '');
    const [header, payload, mac] = ticket.split('.');
    const expected = createHmac('sha256', SIGNING_KEY)
      .update(`${header!}.${payload!}`)
      .digest('base64url');
    expect(mac).toBe(expected);

    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as {
      iss: string;
      aud: string;
      sub: string;
      exp: number;
      iat: number;
    };
    expect(claims.iss).toBe('ferrum');
    // Not 'life-as-code-apps': that one is a browser cookie and leaves the
    // domain, so it must never be able to write.
    expect(claims.aud).toBe('life-as-code-ingest');
    expect(claims.sub).toBe('7');
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(300);
  });

  it('leaves the workout stored when the hub is unreachable', async () => {
    const isolated = pgliteDatabase(new PGlite());
    await migrate(isolated);
    const userId = await findOrCreateUserByIdentity(isolated, SSO_PROVIDER, '9');
    const isolatedToken = (await mintTokenForUser(isolated, userId)).token;
    const app = createApp({
      db: isolated,
      enableDevRoutes: false,
      ssoSigningKey: SIGNING_KEY,
      // Nothing listens here.
      hubApiUrl: 'http://127.0.0.1:9',
    });
    const local = await new Promise<ServerType>(resolve => {
      const started = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => {
        resolve(started);
      });
    });
    const port = (local.address() as { port: number }).port;

    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/sync/push`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${isolatedToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(
          serializePushRequest({ deviceId: 'phone', events: workout(true, 2_000_000) })
        ),
      });
      // The push itself must still succeed: the workout is already durable, and
      // a hub outage is not a reason to tell a lifter their set did not save.
      expect(response.status).toBe(200);

      const pulled = await fetch(
        `http://127.0.0.1:${String(port)}/sync/pull?after=0&purgedAfter=0`,
        { headers: { authorization: `Bearer ${isolatedToken}` } }
      );
      const body = (await pulled.json()) as { events: readonly unknown[] };
      expect(body.events.length).toBeGreaterThan(0);
    } finally {
      local.close();
    }
  });
});
