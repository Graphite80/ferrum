import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { mintToken, mintTokenForUser } from '../auth-tokens.ts';
import { type Database } from '../db.ts';
import { findOrCreateUserByIdentity } from '../identities.ts';
import { type AppEnv } from '../middleware/auth.ts';
import { readSsoCookie, verifySsoTicket, SSO_PROVIDER } from '../sso.ts';

export interface AuthRouteOptions {
  readonly db: Database;
  readonly enableDevRoutes: boolean;
  readonly bootstrapKey: string | undefined;
  readonly ssoSigningKey?: string;
}

export function authRoutes({
  db,
  enableDevRoutes,
  bootstrapKey,
  ssoSigningKey,
}: AuthRouteOptions): Hono<AppEnv> {
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

  if (ssoSigningKey !== undefined) {
    // The identity cookie is ambient: the browser attaches it to any request to
    // this origin, including one a hostile page triggers. A custom header is
    // unforgeable cross-origin without a CORS preflight this API never answers,
    // so it is what separates "our PWA asked" from "someone else's page asked".
    app.post('/auth/sso', async c => {
      if (c.req.header('x-ferrum-sso') !== '1') return c.json({ error: 'unauthorized' }, 401);
      const ticket = readSsoCookie(c.req.header('cookie'));
      if (ticket === null) return c.json({ error: 'no_identity' }, 401);
      const identity = verifySsoTicket(ticket, {
        signingKey: ssoSigningKey,
        nowMillis: Date.now(),
      });
      if (identity === null) return c.json({ error: 'unauthorized' }, 401);
      const userId = await findOrCreateUserByIdentity(db, SSO_PROVIDER, identity.subject);
      const minted = await mintTokenForUser(db, userId);
      return c.json({ ...minted, displayName: identity.displayName });
    });
  }

  return app;
}
