import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import {
  PULL_DEFAULT_LIMIT,
  PULL_MAX_LIMIT,
  isProtocolError,
  parsePushRequest,
  serializePullResponse,
  type ClockDriftRejection,
} from '@ferrum/sync-protocol';
import { type Database } from '../db.ts';
import { requireAuth, type AppEnv } from '../middleware/auth.ts';
import { ClockDriftBatchError, pullPage, pushBatch } from '../sync.ts';

export function syncRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // The PWA may be installed from one origin and pointed at a server on another.
  // Auth is a bearer token, never a cookie, so an open CORS policy grants nothing
  // an attacker's page could not already do with a stolen token.
  app.use('/sync/*', cors());
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
      const response = await db.transaction(tx =>
        pushBatch(tx, c.get('userId'), request, Date.now())
      );
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
    const limitParam = c.req.query('limit');
    const limit = limitParam === undefined ? PULL_DEFAULT_LIMIT : Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > PULL_MAX_LIMIT) {
      return c.json({ error: 'invalid_limit' }, 400);
    }
    const page = await pullPage(db, c.get('userId'), { afterSequence: after, limit });
    return c.json(serializePullResponse(page));
  });

  return app;
}
