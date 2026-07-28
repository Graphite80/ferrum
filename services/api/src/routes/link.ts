import { Hono } from 'hono';
import { mintLinkToken } from '../bot/store.ts';
import { type Database } from '../db.ts';
import { requireAuth, type AppEnv } from '../middleware/auth.ts';

export function linkRoutes(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('/link/*', requireAuth(db));

  app.post('/link/token', async c => {
    const minted = await mintLinkToken(db, c.get('userId'));
    return c.json(minted);
  });

  return app;
}
