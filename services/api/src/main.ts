import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
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

const db = pgDatabase(new pg.Pool({ connectionString: databaseUrl }));
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
  enableDevRoutes: process.env.NODE_ENV !== 'production',
  ...(telegram === undefined ? {} : { telegram }),
});

const staticDir = process.env.STATIC_DIR;
if (staticDir !== undefined && staticDir !== '') {
  app.use('/*', serveStatic({ root: staticDir }));
  app.use('/*', serveStatic({ root: staticDir, rewriteRequestPath: () => '/index.html' }));
}

serve({ fetch: app.fetch, port }, info => {
  console.log(`ferrum api listening on :${info.port}`);
});
