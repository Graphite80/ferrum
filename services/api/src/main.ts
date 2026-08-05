import { serve } from '@hono/node-server';
import pg from 'pg';
import { createApp } from './app.ts';
import { createTelegramBot } from './bot/index.ts';
import { migrate } from './migrate.ts';
import { pgDatabase } from './pg-database.ts';

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('DATABASE_URL is required');
}

const port = Number(process.env.PORT ?? '3000');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`PORT must be a valid port number, received "${process.env.PORT ?? ''}"`);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
pool.on('error', error => {
  console.error('pg pool error', error);
});
const db = pgDatabase(pool);

// The database and this pod are restarted by the same events — a node reboot, a
// containerd restart, a CNPG failover — and the pooler is routinely a few seconds
// behind us. Exiting on the first refused connection turned that into a crash
// loop whose backoff then kept the API down long after Postgres was ready
// (observed 2026-08-05: three restarts, all ECONNREFUSED from migrate). Waiting
// is bounded on purpose: a genuinely wrong DATABASE_URL must still fail loudly
// rather than leave a pod that never serves and never reports why.
const STARTUP_DB_DEADLINE_MILLIS = 90_000;
const STARTUP_DB_RETRY_MILLIS = 3_000;

async function migrateWhenDatabaseAccepts(): Promise<void> {
  const deadline = Date.now() + STARTUP_DB_DEADLINE_MILLIS;
  for (;;) {
    try {
      await migrate(db);
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      console.error(
        `database not ready, retrying: ${error instanceof Error ? error.message : String(error)}`
      );
      await new Promise(resolve => setTimeout(resolve, STARTUP_DB_RETRY_MILLIS));
    }
  }
}

await migrateWhenDatabaseAccepts();

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const telegram =
  botToken !== undefined && botToken !== '' && webhookSecret !== undefined && webhookSecret !== ''
    ? { bot: createTelegramBot({ token: botToken, db }), webhookSecret }
    : undefined;
if (telegram !== undefined) await telegram.bot.init();

const app = createApp({
  db,
  enableDevRoutes: process.env.FERRUM_DEV_ROUTES === '1',
  ...(process.env.AUTH_BOOTSTRAP_KEY === undefined || process.env.AUTH_BOOTSTRAP_KEY === ''
    ? {}
    : { bootstrapKey: process.env.AUTH_BOOTSTRAP_KEY }),
  ...(process.env.SSO_SIGNING_KEY === undefined || process.env.SSO_SIGNING_KEY === ''
    ? {}
    : { ssoSigningKey: process.env.SSO_SIGNING_KEY }),
  ...(process.env.HUB_API_URL === undefined || process.env.HUB_API_URL === ''
    ? {}
    : { hubApiUrl: process.env.HUB_API_URL }),
  ...(telegram === undefined ? {} : { telegram }),
  ...(process.env.STATIC_DIR === undefined || process.env.STATIC_DIR === ''
    ? {}
    : { staticDir: process.env.STATIC_DIR }),
});

const server = serve({ fetch: app.fetch, port }, info => {
  console.log(`ferrum api listening on :${info.port}`);
});

const shutdown = () => {
  server.close(() => {
    void pool.end().then(() => {
      process.exit(0);
    });
  });
};
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, shutdown);
}
