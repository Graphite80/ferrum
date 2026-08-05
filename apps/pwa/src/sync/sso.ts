// Signing in must not be a second account to create: the hub's identity cookie
// is already attached to every request to this origin, so once the lifter asks,
// the app can trade it for a sync token with no password and no redirect. Asking
// is the precondition — this is never called from start-up, because the cookie
// is ambient and spending it unbidden would enrol a browser rather than a person
// (see "No account by default" in CLAUDE.md). Nothing here is allowed to throw:
// a hub that is down, or an origin that serves the PWA without the API behind
// it, must leave a working offline logger, not a broken button.

export type HubSignInOutcome = 'granted' | 'no-identity' | 'unavailable';

export interface HubSignIn {
  readonly outcome: HubSignInOutcome;
  readonly token: string | null;
  readonly displayName: string | null;
}

const REQUEST_TIMEOUT_MILLIS = 8_000;

const DENIED: HubSignIn = { outcome: 'no-identity', token: null, displayName: null };
const UNAVAILABLE: HubSignIn = { outcome: 'unavailable', token: null, displayName: null };

export async function requestHubToken(origin: string): Promise<HubSignIn> {
  let response: Response;
  try {
    response = await fetch(`${origin}/auth/sso`, {
      method: 'POST',
      // The header is what the API uses to tell our own page apart from a
      // hostile one riding the ambient cookie; see routes/auth.ts.
      headers: { 'x-ferrum-sso': '1' },
      credentials: 'same-origin',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLIS),
    });
  } catch {
    return UNAVAILABLE;
  }

  if (response.status === 401) return DENIED;
  if (!response.ok) return UNAVAILABLE;

  let body: { signedIn?: unknown; token?: unknown; displayName?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return UNAVAILABLE;
  }
  // The common answer: nobody is signed in to the hub in this browser. It is a
  // 200 on purpose — see routes/auth.ts — so it has to be read from the body.
  if (body.signedIn !== true) return DENIED;
  if (typeof body.token !== 'string' || body.token === '') return UNAVAILABLE;

  return {
    outcome: 'granted',
    token: body.token,
    displayName: typeof body.displayName === 'string' ? body.displayName : null,
  };
}
