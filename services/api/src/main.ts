import { serve } from '@hono/node-server';
import pg from 'pg';
import { createApp } from './app.ts';
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

const app = createApp({ db, enableDevRoutes: process.env.NODE_ENV !== 'production' });

serve({ fetch: app.fetch, port }, info => {
  console.log(`ferrum api listening on :${info.port}`);
});
