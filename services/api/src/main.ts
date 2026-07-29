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
await migrate(db);

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
