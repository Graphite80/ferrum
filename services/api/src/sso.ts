import { createHmac, timingSafeEqual } from 'node:crypto';

// life-as-code is the hub: it authenticates the human and hands sibling apps a
// signed, short-lived statement of who that is. Ferrum verifies the statement
// offline — no callback to the hub on the login path, so a hub outage cannot
// lock a lifter out of a session already in progress.

export const SSO_PROVIDER = 'life-as-code';
export const SSO_ISSUER = 'life-as-code';
export const SSO_AUDIENCE = 'life-as-code-apps';

// The __Secure- prefix pins the cookie to HTTPS while still allowing the
// Domain attribute that __Host- forbids and this cookie needs: it is set on
// life-as-code.com and read on ferrum.life-as-code.com. The bare name is the
// local-development fallback, where there is no TLS to prefix against.
export const SSO_COOKIE_NAMES = ['__Secure-lac-sso', 'lac-sso'] as const;

// A stolen ticket is a login. Rejecting anything with more than a day of life
// left caps the damage even if the hub is ever misconfigured to mint one.
const MAX_TICKET_LIFETIME_SECONDS = 86_400;

export interface SsoIdentity {
  readonly subject: string;
  readonly displayName: string | null;
}

export interface SsoVerifyOptions {
  readonly signingKey: string;
  readonly nowMillis: number;
}

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
}

function signatureMatches(signingKey: string, signedPart: string, presented: string): boolean {
  const expected = createHmac('sha256', signingKey).update(signedPart).digest();
  const actual = Buffer.from(presented, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function verifySsoTicket(
  ticket: string,
  { signingKey, nowMillis }: SsoVerifyOptions
): SsoIdentity | null {
  const parts = ticket.split('.');
  if (parts.length !== 3) return null;
  const [headerSegment, payloadSegment, signatureSegment] = parts;
  if (
    headerSegment === undefined ||
    payloadSegment === undefined ||
    signatureSegment === undefined
  ) {
    return null;
  }
  if (!signatureMatches(signingKey, `${headerSegment}.${payloadSegment}`, signatureSegment)) {
    return null;
  }

  let header: unknown;
  let payload: unknown;
  try {
    header = decodeSegment(headerSegment);
    payload = decodeSegment(payloadSegment);
  } catch {
    return null;
  }
  if (!isRecord(header) || header['alg'] !== 'HS256') return null;
  if (!isRecord(payload)) return null;

  if (payload['iss'] !== SSO_ISSUER) return null;
  const audience = payload['aud'];
  const audienceMatches = Array.isArray(audience)
    ? audience.includes(SSO_AUDIENCE)
    : audience === SSO_AUDIENCE;
  if (!audienceMatches) return null;

  const expiresAt = payload['exp'];
  const issuedAt = payload['iat'];
  if (typeof expiresAt !== 'number' || typeof issuedAt !== 'number') return null;
  const nowSeconds = Math.floor(nowMillis / 1000);
  if (expiresAt <= nowSeconds) return null;
  if (expiresAt - issuedAt > MAX_TICKET_LIFETIME_SECONDS) return null;
  // A ticket dated in the future is either a clock problem or a forgery attempt
  // against the lifetime cap above; a minute of slack absorbs honest skew.
  if (issuedAt > nowSeconds + 60) return null;

  const subject = payload['sub'];
  if (typeof subject !== 'string' || subject.length === 0) return null;
  const name = payload['name'];

  return { subject, displayName: typeof name === 'string' && name.length > 0 ? name : null };
}

export function readSsoCookie(cookieHeader: string | undefined): string | null {
  if (cookieHeader === undefined) return null;
  const jar = new Map<string, string>();
  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    const name = pair.slice(0, separator).trim();
    if (!jar.has(name)) jar.set(name, pair.slice(separator + 1).trim());
  }
  for (const name of SSO_COOKIE_NAMES) {
    const value = jar.get(name);
    if (value !== undefined && value !== '') return value;
  }
  return null;
}
