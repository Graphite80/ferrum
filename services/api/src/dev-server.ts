import { serve } from '@hono/node-server';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from './app.ts';
import { migrate } from './migrate.ts';
import { pgliteDatabase } from './pglite-database.ts';

const port = Number(process.env.PORT ?? '3100');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`PORT must be a valid port number, received "${process.env.PORT ?? ''}"`);
}

const dataDir = process.env.PGLITE_DIR;
const pglite = dataDir === undefined || dataDir === '' ? new PGlite() : new PGlite(dataDir);
const db = pgliteDatabase(pglite);
await migrate(db);

const app = createApp({ db, enableDevRoutes: true });

const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, info => {
  console.log(
    `ferrum dev api (pglite${dataDir ? `: ${dataDir}` : ', in-memory'}) on :${info.port}`
  );
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close();
    void pglite.close().finally(() => {
      process.exit(0);
    });
  });
}
