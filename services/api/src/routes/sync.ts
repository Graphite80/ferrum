import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  PULL_DEFAULT_LIMIT,
  PULL_MAX_LIMIT,
  isProtocolError,
  parsePurgeRequest,
  parsePushRequest,
  serializePullResponse,
  serializePurgeResponse,
  type ClockDriftRejection,
} from '@ferrum/sync-protocol';
import { type Database } from '../db.ts';
import { exportSessionsToHub } from '../hub-export.ts';
import { requireAuth, type AppEnv } from '../middleware/auth.ts';
import { ClockDriftBatchError, pullPage, purgeAggregates, pushBatch } from '../sync.ts';

export interface SyncRouteOptions {
  // Both present => a finished workout is pushed on to the hub after it lands.
  readonly ssoSigningKey?: string;
  readonly hubApiUrl?: string;
  readonly log?: (message: string) => void;
}

export function syncRoutes(db: Database, options: SyncRouteOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // No CORS. It was here for a PWA installed on one origin and pointed at a server
  // on another, which is not a thing any more — sync is a relative path against the
  // page's own origin. What the middleware still did was answer preflights on a
  // public endpoint and parse Access-Control-Request-Headers, which is where
  // GHSA-8j4g-w8fx-2239 (ReDoS) lives. Same-origin needs none of it.
  app.use('/sync/*', requireAuth(db));
  app.use('/sync/push', bodyLimit({ maxSize: 5 * 1024 * 1024 }));

  app.post('/sync/push', async c => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const request = parsePushRequest(body);
    if (isProtocolError(request)) return c.json(request, 400);
    try {
      const userId = c.get('userId');
      const response = await db.transaction(tx => pushBatch(tx, userId, request, Date.now()));
      // After the batch is durable, never inside its transaction: the hub being
      // slow or down must not roll back a workout that is already safely stored.
      if (options.ssoSigningKey !== undefined && options.hubApiUrl !== undefined) {
        const touched = [...new Set(request.events.map(event => event.aggregateId))];
        await exportSessionsToHub(
          db,
          userId,
          touched,
          options.ssoSigningKey,
          options.hubApiUrl,
          options.log ?? (() => undefined),
          Date.now()
        );
      }
      return c.json(response);
    } catch (error) {
      if (error instanceof ClockDriftBatchError) {
        const rejection: ClockDriftRejection = {
          code: 'clock_drift',
          driftedEventIds: error.driftedEventIds,
        };
        return c.json(rejection, 409);
      }
      throw error;
    }
  });

  app.get('/sync/pull', async c => {
    const after = Number(c.req.query('after') ?? '0');
    if (!Number.isInteger(after) || after < 0) {
      return c.json({ error: 'invalid_after' }, 400);
    }
    const purgedAfter = Number(c.req.query('purgedAfter') ?? '0');
    if (!Number.isInteger(purgedAfter) || purgedAfter < 0) {
      return c.json({ error: 'invalid_purged_after' }, 400);
    }
    const limitParam = c.req.query('limit');
    const limit = limitParam === undefined ? PULL_DEFAULT_LIMIT : Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > PULL_MAX_LIMIT) {
      return c.json({ error: 'invalid_limit' }, 400);
    }
    const page = await pullPage(db, c.get('userId'), {
      afterSequence: after,
      limit,
      afterPurgeSequence: purgedAfter,
    });
    return c.json(serializePullResponse(page));
  });

  // Destroying data is the one sync operation with no undo, so it is its own
  // endpoint rather than an event type: nothing about it converges, and nothing
  // about it can be replayed.
  app.post('/sync/purge', async c => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const request = parsePurgeRequest(body);
    if (isProtocolError(request)) return c.json(request, 400);
    const response = await db.transaction(tx => purgeAggregates(tx, c.get('userId'), request));
    return c.json(serializePurgeResponse(response));
  });

  return app;
}
