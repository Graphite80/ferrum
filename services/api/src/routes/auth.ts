import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { mintToken, mintTokenForUser } from '../auth-tokens.ts';
import { type Database } from '../db.ts';
import { backfillFromHub } from '../hub-import.ts';
import { findOrCreateUserByIdentity } from '../identities.ts';
import { type AppEnv } from '../middleware/auth.ts';
import { readSsoCookie, verifySsoTicket, SSO_PROVIDER } from '../sso.ts';

export interface AuthRouteOptions {
  readonly db: Database;
  readonly enableDevRoutes: boolean;
  readonly bootstrapKey: string | undefined;
  readonly ssoSigningKey?: string;
  // Cluster-local base URL of the hub. Absent => no backfill, sign-in still works.
  readonly hubApiUrl?: string;
  readonly log?: (message: string) => void;
}

export function authRoutes({
  db,
  enableDevRoutes,
  bootstrapKey,
  ssoSigningKey,
  hubApiUrl,
  log = () => {
    /* the request logger already records the status; this is the extra detail */
  },
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
      // "Nobody is signed in to the hub in this browser" is the answer to the
      // question, not a failure of it — and the app asks on every cold start.
      // A 401 here would put a red line in the console of every visitor who has
      // not used the hub, bury the 401s that do mean something in the pod log,
      // and hand the crawler a network-error finding on every page.
      if (ticket === null) return c.json({ signedIn: false });
      const identity = verifySsoTicket(ticket, {
        signingKey: ssoSigningKey,
        nowMillis: Date.now(),
      });
      if (identity === null) {
        // Every unsigned-in visitor produces a 401 here, so the status alone
        // says nothing. A ticket that WAS presented and did not verify is the
        // one that matters: it is what a signing-key drift between this service
        // and the hub looks like, and otherwise it would be invisible in a sea
        // of identical lines.
        log(JSON.stringify({ level: 'warn', event: 'sso_ticket_rejected' }));
        return c.json({ error: 'unauthorized' }, 401);
      }
      const userId = await findOrCreateUserByIdentity(db, SSO_PROVIDER, identity.subject);
      const minted = await mintTokenForUser(db, userId);
      // Inline rather than fire-and-forget: measured at 1.3s for five years of
      // history, and a background job that failed would leave the app showing an
      // empty account with nothing to retry against.
      const backfill =
        hubApiUrl === undefined ? null : await backfillFromHub(db, userId, ticket, hubApiUrl, log);
      return c.json({
        signedIn: true,
        ...minted,
        displayName: identity.displayName,
        ...(backfill === null ? {} : { backfill }),
      });
    });
  }

  return app;
}
