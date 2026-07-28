import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { mintToken } from '../auth-tokens.ts';
import { type Database } from '../db.ts';
import { type AppEnv } from '../middleware/auth.ts';

export interface AuthRouteOptions {
  readonly db: Database;
  readonly enableDevRoutes: boolean;
  readonly bootstrapKey: string | undefined;
}

export function authRoutes({ db, enableDevRoutes, bootstrapKey }: AuthRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  if (enableDevRoutes) {
    app.post('/dev/token', async c => c.json(await mintToken(db)));
  }

  if (bootstrapKey !== undefined) {
    app.post('/auth/bootstrap', async c => {
      const presented = c.req.header('x-bootstrap-key') ?? '';
      const expected = Buffer.from(bootstrapKey);
      const actual = Buffer.from(presented);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      return c.json(await mintToken(db));
    });
  }

  return app;
}
