import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { webhookCallback, type Bot } from 'grammy';
import { type Database } from './db.ts';
import { type AppEnv } from './middleware/auth.ts';
import { authRoutes } from './routes/auth.ts';
import { linkRoutes } from './routes/link.ts';
import { syncRoutes } from './routes/sync.ts';

export interface TelegramMount {
  readonly bot: Bot;
  readonly webhookSecret: string;
}

export interface AppOptions {
  readonly db: Database;
  readonly enableDevRoutes: boolean;
  readonly bootstrapKey?: string;
  readonly telegram?: TelegramMount;
  readonly staticDir?: string;
}

// Namespaces the single-page fallback must never answer for. Without this list a
// POST to a mistyped endpoint, or a GET on a POST-only route, returns index.html
// with a 200 — a write that reports success while nothing happened.
const API_PREFIXES = ['/health', '/ready', '/auth', '/dev', '/sync', '/link', '/telegram'];

function isApiPath(path: string): boolean {
  return API_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

export function createApp({
  db,
  enableDevRoutes,
  bootstrapKey,
  telegram,
  staticDir,
}: AppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/health', c => c.json({ ok: true }));

  app.get('/ready', async c => {
    try {
      await db.orm.execute(sql`select 1`);
      return c.json({ ready: true });
    } catch {
      return c.json({ ready: false }, 503);
    }
  });

  app.route('/', authRoutes({ db, enableDevRoutes, bootstrapKey }));
  app.route('/', syncRoutes(db));
  app.route('/', linkRoutes(db));

  if (telegram !== undefined) {
    const handleUpdate = webhookCallback(telegram.bot, 'hono', {
      secretToken: telegram.webhookSecret,
      // 'return' instead of the default 'throw': a slow import must not become
      // a 500 that makes Telegram redeliver the same update while the first
      // attempt is still running.
      timeoutMilliseconds: 55_000,
      onTimeout: 'return',
    });
    app.post('/telegram/webhook', c => handleUpdate(c));
  }

  if (staticDir !== undefined && staticDir !== '') {
    app.use('/*', async (c, next) => {
      if (isApiPath(c.req.path) || (c.req.method !== 'GET' && c.req.method !== 'HEAD')) {
        return c.json({ error: 'not_found' }, 404);
      }
      await next();
    });
    app.use('/*', serveStatic({ root: staticDir }));
    app.use('/*', serveStatic({ root: staticDir, rewriteRequestPath: () => '/index.html' }));
  }

  return app;
}
