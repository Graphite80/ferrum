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
  // Shared with life-as-code, which signs the identity cookie this API verifies.
  readonly ssoSigningKey?: string;
  // Cluster-local base URL of the hub, for the first-sign-in history backfill.
  readonly hubApiUrl?: string;
  readonly telegram?: TelegramMount;
  readonly staticDir?: string;
  // Injected so a test can assert on what would reach the pod log instead of
  // scraping stderr.
  readonly log?: (message: string) => void;
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
  ssoSigningKey,
  hubApiUrl,
  telegram,
  staticDir,
  log = message => {
    globalThis.console.error(message);
  },
}: AppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Only failures, and only for API paths. Logging every request would drown the one
  // line that matters in asset fetches; logging nothing — which is what this service did
  // — means a 5xx in production leaves no trace at all, and the QA pass that reads these
  // logs after every deploy has nothing to read.
  app.use('/*', async (c, next) => {
    const startedAt = Date.now();
    await next();
    const isRead = c.req.method === 'GET' || c.req.method === 'HEAD';
    // A failed write is worth a line whatever path it was aimed at: it means a client
    // believes an endpoint exists that does not.
    if (c.res.status < 400 || (isRead && !isApiPath(c.req.path))) return;
    log(
      JSON.stringify({
        level: c.res.status >= 500 ? 'error' : 'warn',
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - startedAt,
      })
    );
  });

  // Hono's default handler answers text/plain, so an unhandled exception was the one
  // response in this API that a JSON client could not parse.
  app.onError((error, c) => {
    log(
      JSON.stringify({
        level: 'error',
        method: c.req.method,
        path: c.req.path,
        status: 500,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return c.json({ error: 'internal_error' }, 500);
  });

  app.get('/health', c => c.json({ ok: true }));

  app.get('/ready', async c => {
    try {
      await db.orm.execute(sql`select 1`);
      return c.json({ ready: true });
    } catch {
      return c.json({ ready: false }, 503);
    }
  });

  app.route(
    '/',
    authRoutes({
      db,
      enableDevRoutes,
      bootstrapKey,
      log,
      ...(ssoSigningKey === undefined ? {} : { ssoSigningKey }),
      ...(hubApiUrl === undefined ? {} : { hubApiUrl }),
    })
  );
  app.route(
    '/',
    syncRoutes(db, {
      log,
      ...(ssoSigningKey === undefined ? {} : { ssoSigningKey }),
      ...(hubApiUrl === undefined ? {} : { hubApiUrl }),
    })
  );
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
      // Without an explicit header the origin sends none, the edge applies a
      // four-hour default and browsers fall back to heuristic freshness — so a
      // released index.html can keep pointing at the previous build's bundles
      // for hours, which is the one cache failure no amount of clearing fixes.
      // /assets/ filenames carry a content hash, so they are safe to pin
      // forever; everything else (index.html, the service worker, the manifest)
      // is a mutable entry point and must be revalidated every time.
      if (c.res.ok) {
        c.res.headers.set(
          'cache-control',
          c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
        );
      }
    });
    app.use('/*', serveStatic({ root: staticDir }));
    app.use('/*', serveStatic({ root: staticDir, rewriteRequestPath: () => '/index.html' }));
  }

  return app;
}
