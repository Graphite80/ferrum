import { randomUUID } from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { webhookCallback, type Bot } from 'grammy';
import {
  PULL_DEFAULT_LIMIT,
  PULL_MAX_LIMIT,
  isProtocolError,
  parsePushRequest,
  serializePullResponse,
  type ClockDriftRejection,
} from '@ferrum/sync-protocol';
import { type Database } from './db.ts';
import { ClockDriftBatchError, pullPage, pushBatch } from './sync.ts';
import { mintLinkToken } from './bot/store.ts';

export interface TelegramMount {
  readonly bot: Bot;
  readonly webhookSecret: string;
}

export interface AppOptions {
  readonly db: Database;
  readonly enableDevRoutes: boolean;
  readonly telegram?: TelegramMount;
}

type AppEnv = { Variables: { userId: string } };

export function createApp({ db, enableDevRoutes, telegram }: AppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/health', c => c.json({ ok: true }));

  if (enableDevRoutes) {
    app.post('/dev/token', async c => {
      const created = await db.query('insert into users default values returning id');
      const userId = String(created.rows[0]?.id);
      const token = randomUUID();
      await db.query('insert into auth_tokens (token, user_id) values ($1, $2)', [token, userId]);
      return c.json({ userId, token });
    });
  }

  const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
    const header = c.req.header('authorization');
    if (header === undefined || !header.toLowerCase().startsWith('bearer ')) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const token = header.slice('bearer '.length).trim();
    if (token.length === 0) return c.json({ error: 'unauthorized' }, 401);
    const found = await db.query('select user_id from auth_tokens where token = $1', [token]);
    const row = found.rows[0];
    if (row === undefined) return c.json({ error: 'unauthorized' }, 401);
    c.set('userId', String(row.user_id));
    await next();
  };

  // The PWA may be installed from one origin and pointed at a server on another.
  // Auth is a bearer token, never a cookie, so an open CORS policy grants nothing
  // an attacker's page could not already do with a stolen token.
  app.use('/sync/*', cors());
  app.use('/sync/*', requireAuth);
  app.use('/link/*', requireAuth);

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

  app.post('/link/token', async c => {
    const minted = await mintLinkToken(db, c.get('userId'));
    return c.json(minted);
  });

  if (telegram !== undefined) {
    const handleUpdate = webhookCallback(telegram.bot, 'hono', {
      secretToken: telegram.webhookSecret,
    });
    app.post('/telegram/webhook', c => handleUpdate(c));
  }

  return app;
}
