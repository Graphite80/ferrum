import { createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { migrate } from '../src/migrate.ts';
import { pgliteDatabase } from '../src/pglite-database.ts';

// The signer lives in life-as-code (Python). This is the same construction,
// written independently against the wire format rather than importing ferrum's
// verifier — a test that reuses the code under test proves only self-consistency.
const SIGNING_KEY = 'a-shared-signing-key-of-adequate-length';

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

interface TicketOverrides {
  readonly iss?: string;
  readonly aud?: string;
  readonly sub?: string;
  readonly name?: string;
  readonly iat?: number;
  readonly exp?: number;
  readonly key?: string;
  readonly alg?: string;
}

function ticket(overrides: TicketOverrides = {}): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = encode({ alg: overrides.alg ?? 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: overrides.iss ?? 'life-as-code',
    aud: overrides.aud ?? 'life-as-code-apps',
    sub: overrides.sub ?? '1',
    name: overrides.name ?? 'nikolay',
    iat: overrides.iat ?? nowSeconds,
    exp: overrides.exp ?? nowSeconds + 600,
  });
  const signature = createHmac('sha256', overrides.key ?? SIGNING_KEY)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

let server: ServerType;
let baseUrl = '';
let disabledServer: ServerType;
let disabledUrl = '';
const logLines: string[] = [];

beforeAll(async () => {
  const db = pgliteDatabase(new PGlite());
  await migrate(db);
  const app = createApp({
    db,
    enableDevRoutes: false,
    ssoSigningKey: SIGNING_KEY,
    log: message => logLines.push(message),
  });
  await new Promise<void>(resolve => {
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, info => {
      baseUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });

  const disabledDb = pgliteDatabase(new PGlite());
  await migrate(disabledDb);
  const withoutSso = createApp({ db: disabledDb, enableDevRoutes: false });
  await new Promise<void>(resolve => {
    disabledServer = serve({ fetch: withoutSso.fetch, port: 0, hostname: '127.0.0.1' }, info => {
      disabledUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
  disabledServer.close();
});

async function signIn(cookie: string | null, url = baseUrl): Promise<Response> {
  const headers: Record<string, string> = { 'x-ferrum-sso': '1' };
  if (cookie !== null) headers.cookie = cookie;
  return fetch(`${url}/auth/sso`, { method: 'POST', headers });
}

describe('single sign-on from life-as-code', () => {
  it('exchanges a valid identity cookie for a working sync token', async () => {
    const response = await signIn(`__Secure-lac-sso=${ticket({ sub: '7' })}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      signedIn: boolean;
      userId: string;
      token: string;
      displayName: string | null;
    };
    expect(body.signedIn).toBe(true);
    expect(body.displayName).toBe('nikolay');

    const pull = await fetch(`${baseUrl}/sync/pull?after=0&purgedAfter=0`, {
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(pull.status).toBe(200);
  });

  it('returns the same account for the same hub user on a second device', async () => {
    const first = (await (await signIn(`__Secure-lac-sso=${ticket({ sub: '42' })}`)).json()) as {
      userId: string;
      token: string;
    };
    const second = (await (await signIn(`lac-sso=${ticket({ sub: '42' })}`)).json()) as {
      userId: string;
      token: string;
    };
    expect(second.userId).toBe(first.userId);
    expect(second.token).not.toBe(first.token);
  });

  it('gives different hub users different accounts', async () => {
    const alice = (await (await signIn(`__Secure-lac-sso=${ticket({ sub: 'alice' })}`)).json()) as {
      userId: string;
    };
    const bob = (await (await signIn(`__Secure-lac-sso=${ticket({ sub: 'bob' })}`)).json()) as {
      userId: string;
    };
    expect(alice.userId).not.toBe(bob.userId);
  });

  it('reads the identity cookie out of a jar that carries other cookies', async () => {
    const response = await signIn(
      `theme=dark; __Secure-lac-sso=${ticket({ sub: '7' })}; other=value`
    );
    expect(response.status).toBe(200);
  });

  // Answered 200 with signedIn:false, not 401: the app asks on every cold start,
  // so "nobody is signed in here" must not read as an error to the browser
  // console, the pod log or the crawler. What must never happen is a token.
  it.each([
    ['no cookie at all', null],
    ['an unrelated cookie jar', 'theme=dark'],
    ['an empty ticket', '__Secure-lac-sso='],
  ])('answers %s quietly, and without a token', async (_label, cookie) => {
    const response = await signIn(cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ signedIn: false });
  });

  it.each([
    ['a truncated ticket', '__Secure-lac-sso=only.two'],
    ['a ticket signed with another key', `__Secure-lac-sso=${ticket({ key: 'wrong-key' })}`],
    ['an expired ticket', `__Secure-lac-sso=${ticket({ exp: Math.floor(Date.now() / 1000) - 1 })}`],
    ['a ticket from another issuer', `__Secure-lac-sso=${ticket({ iss: 'evil' })}`],
    ['a ticket for another audience', `__Secure-lac-sso=${ticket({ aud: 'someone-else' })}`],
    ['a ticket with an empty subject', `__Secure-lac-sso=${ticket({ sub: '' })}`],
    ['an unsigned "none" ticket', `__Secure-lac-sso=${ticket({ alg: 'none' })}`],
    [
      'a ticket that outlives the one-day cap',
      `__Secure-lac-sso=${ticket({ exp: Math.floor(Date.now() / 1000) + 86_401 })}`,
    ],
    [
      'a ticket dated in the future',
      `__Secure-lac-sso=${ticket({ iat: Math.floor(Date.now() / 1000) + 3600 })}`,
    ],
  ])('refuses %s', async (_label, cookie) => {
    const response = await signIn(cookie);
    expect(response.status).toBe(401);
  });

  it('refuses a request that omits the anti-forgery header', async () => {
    const response = await fetch(`${baseUrl}/auth/sso`, {
      method: 'POST',
      headers: { cookie: `__Secure-lac-sso=${ticket()}` },
    });
    expect(response.status).toBe(401);
  });

  // A signing-key drift between this service and the hub is the documented way
  // this feature fails, and it produces the same 401 as every visitor who is
  // simply not signed in. The log line is the only thing that tells them apart.
  it('logs a rejected ticket, and stays quiet when none was presented', async () => {
    logLines.length = 0;
    await signIn(null);
    await signIn('theme=dark');
    expect(logLines.filter(line => line.includes('sso_ticket_rejected'))).toHaveLength(0);

    await signIn(`__Secure-lac-sso=${ticket({ key: 'a-drifted-signing-key-of-length' })}`);
    expect(logLines.filter(line => line.includes('sso_ticket_rejected'))).toHaveLength(1);
  });

  it('does not expose the endpoint when no signing key is configured', async () => {
    const response = await signIn(`__Secure-lac-sso=${ticket()}`, disabledUrl);
    expect(response.status).toBe(404);
  });
});
