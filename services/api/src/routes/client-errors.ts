import { Hono } from 'hono';
import { type AppEnv } from '../middleware/auth.ts';

// An error the user hit that nobody can see did not get fixed. The PWA runs
// offline-first on a phone in a gym bag, so a broken build surfaces as "it just
// stopped working" weeks later, if at all — unless the browser says so at the
// moment it breaks.
//
// Deliberately unauthenticated: the errors worth hearing about include the ones
// that break auth itself, and a report is the only thing a wedged client can
// still do. That makes the endpoint a shouting channel for anyone, so it takes
// nothing but a bounded, shaped report, stores nothing, and only logs — the
// blast radius of abuse is log volume, bounded below by the size cap and the
// per-window limit.
const MAX_BODY_BYTES = 16_384;
const WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 60;
const FIELD_LIMIT = 2_000;

interface ClientErrorReport {
  category?: unknown;
  type?: unknown;
  message?: unknown;
  appVersion?: unknown;
  route?: unknown;
  stack?: unknown;
  fingerprint?: unknown;
}

const text = (value: unknown, limit = FIELD_LIMIT): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, limit) : undefined;

export function clientErrorRoutes(log: (message: string) => void): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  let windowStartedAt = 0;
  let reportsInWindow = 0;

  app.post('/api/v1/client-errors', async c => {
    const now = Date.now();
    if (now - windowStartedAt > WINDOW_MS) {
      windowStartedAt = now;
      reportsInWindow = 0;
    }
    reportsInWindow += 1;
    // Accepted, not stored: a client stuck in a render loop must not be able to
    // fill the log, and it must not learn to retry either.
    if (reportsInWindow > MAX_REPORTS_PER_WINDOW) return c.body(null, 204);

    const raw = await c.req.text();
    if (raw.length > MAX_BODY_BYTES) return c.json({ error: 'too_large' }, 413);

    let report: ClientErrorReport;
    try {
      report = JSON.parse(raw) as ClientErrorReport;
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const message = text(report.message);
    if (message === undefined) return c.json({ error: 'message_required' }, 400);

    log(
      JSON.stringify({
        level: 'warn',
        src: 'client_error',
        category: text(report.category, 32) ?? 'other',
        type: text(report.type, 64) ?? 'Error',
        message,
        appVersion: text(report.appVersion, 64) ?? 'unknown',
        route: text(report.route, 200),
        fingerprint: text(report.fingerprint, 64),
        stack: text(report.stack),
      })
    );
    return c.body(null, 204);
  });

  return app;
}
