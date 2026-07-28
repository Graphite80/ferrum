import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
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
}

export function createApp({
  db,
  enableDevRoutes,
  bootstrapKey,
  telegram,
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

  return app;
}
