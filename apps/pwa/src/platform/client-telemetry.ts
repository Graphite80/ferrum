// COPY of the canonical client-error telemetry module. yay-tsa
// (packages/platform/src/web/client-telemetry.ts) is the source of truth — fix it
// there and re-sync this file rather than editing it here. Dependency-free by
// design, which is what makes the copy a copy and not a package.
//
// What it does: installs global error/unhandledrejection/resource/SW handlers,
// dedupes + fingerprints + caps, scrubs secrets and URLs, drops known browser
// noise (extensions / ResizeObserver / opaque Script error.), and ships each
// surviving report to `endpoint` via sendBeacon (fetch keepalive fallback).
//
// Privacy hard-lines baked in: never captures request/response bodies or DOM,
// scrubs tokens/JWT/cookies/CSRF and strips URL query-strings + fragments, caps
// the payload at 16 KB. ChunkLoadError / "Loading chunk … failed" are treated as
// SIGNAL (a deploy/CDN regression), not dropped as noise.

export type ClientTelemetryCategory =
  | 'runtime'
  | 'promise'
  | 'react'
  | 'network'
  | 'audio'
  | 'sw'
  | 'resource'
  | 'playback'
  | 'auth'
  | 'offline'
  | 'device'
  | 'other';

export interface ClientTelemetryReport {
  category: ClientTelemetryCategory;
  type: string;
  message: string;
  appVersion: string;
  telemetrySessionId: string;
  // Explicitly `| undefined`: the repo compiles with exactOptionalPropertyTypes, and
  // every one of these is filled from something that may have nothing to say. They
  // are dropped by JSON.stringify either way.
  fingerprint?: string | undefined;
  route?: string | undefined;
  stack?: string | undefined;
  uaReduced?: string | undefined;
  http?: { status?: number; method?: string; route?: string } | undefined;
  audio?:
    | {
        state?: string;
        mediaError?: number | null;
        readyState?: number;
        networkState?: number;
      }
    | undefined;
}

export interface ClientTelemetryOptions {
  endpoint: string;
  appVersion: string;
  denyList?: ReadonlyArray<RegExp>;
  scrub?: (input: string) => string;
}

export interface ClientTelemetryHandle {
  report(error: unknown, category: ClientTelemetryCategory, extra?: CaptureExtra): void;
  setRoute(route: string): void;
  uninstall(): void;
}

interface CaptureExtra {
  type?: string;
  message?: string;
  route?: string;
  stack?: string;
  http?: NonNullable<ClientTelemetryReport['http']>;
  audio?: NonNullable<ClientTelemetryReport['audio']>;
}

const MAX_DISTINCT_PER_SESSION = 25;
const MAX_MESSAGE_LENGTH = 1024;
const MAX_STACK_LENGTH = 4096;
const MAX_TYPE_LENGTH = 100;
const KEEPALIVE_BYTE_BUDGET = 16 * 1024;

// Browser noise that is never your bug and never actionable. ChunkLoadError is
// deliberately NOT here — it signals a stale-cache/deploy regression.
const DEFAULT_DENY_LIST: ReadonlyArray<RegExp> = [
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i,
  /Non-Error promise rejection captured/i,
];

const EXTENSION_FRAME = /(chrome|moz|safari|safari-web)-extension:\/\//i;

export function redactSecrets(input: string): string {
  let out = input
    .replace(/api_key=[^&\s"')<>]+/gi, 'api_key=[REDACTED]')
    .replace(/access_token=[^&\s"')<>]+/gi, 'access_token=[REDACTED]')
    .replace(/token=[^&\s"')<>]+/gi, 'token=[REDACTED]')
    .replace(/password=[^&\s"')<>]+/gi, 'password=[REDACTED]')
    .replace(/Bearer\s+[^\s"')<>]+/gi, 'Bearer [REDACTED]')
    // Bare JWTs (header.payload.signature) anywhere in the text.
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
    // Cookie / CSRF header-ish key:value pairs.
    .replace(/(cookie|csrf[-_]?token|x-csrf-token)\s*[:=]\s*[^\s;"']+/gi, '$1=[REDACTED]')
    // Email addresses — PII that leaks through thrown-error messages (matters for
    // the health/finance apps that vendor this module).
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]');
  // Strip query strings and fragments from any URL — they routinely carry
  // reset/magic-link/signed-URL tokens. Keep scheme://host/path only.
  out = out.replace(/(https?:\/\/[^\s"'<>]+?)[?#][^\s"'<>]*/gi, '$1');
  return out;
}

function defaultScrub(input: string): string {
  return redactSecrets(input);
}

class ClientTelemetry implements ClientTelemetryHandle {
  private readonly sessionId = newSessionId();
  private readonly seen = new Set<string>();
  private readonly options: ClientTelemetryOptions;
  private readonly denyList: ReadonlyArray<RegExp>;
  private readonly scrub: (input: string) => string;
  private route: string | undefined;
  private capturing = false;
  private listeners: Array<() => void> = [];

  // No constructor parameter properties: some vendoring apps compile with
  // `erasableSyntaxOnly`, which rejects them (TS1294).
  constructor(options: ClientTelemetryOptions) {
    this.options = options;
    this.denyList = [...DEFAULT_DENY_LIST, ...(options.denyList ?? [])];
    this.scrub = options.scrub ?? defaultScrub;
  }

  setRoute(route: string): void {
    this.route = route;
  }

  report(error: unknown, category: ClientTelemetryCategory, extra: CaptureExtra = {}): void {
    if (this.capturing) return;
    this.capturing = true;
    try {
      const type = truncate(extra.type ?? errorName(error), MAX_TYPE_LENGTH);
      const rawMessage = extra.message ?? errorMessage(error);
      const rawStack = extra.stack ?? errorStack(error);

      if (this.isNoise(rawMessage, rawStack)) return;

      const message = this.scrub(truncate(rawMessage, MAX_MESSAGE_LENGTH));
      const fingerprint = fingerprintOf(category, type, message);
      if (this.seen.has(fingerprint)) return;
      if (this.seen.size >= MAX_DISTINCT_PER_SESSION) return;
      this.seen.add(fingerprint);

      const report: ClientTelemetryReport = {
        category,
        type,
        message,
        appVersion: this.options.appVersion,
        telemetrySessionId: this.sessionId,
        fingerprint,
        route: extra.route ?? this.route ?? currentRoute(),
        stack: rawStack ? this.scrub(truncate(rawStack, MAX_STACK_LENGTH)) : undefined,
        uaReduced: reduceUserAgent(navigator.userAgent),
        http: extra.http,
        audio: extra.audio,
      };
      this.send(report);
    } catch {
      /* telemetry must never throw */
    } finally {
      this.capturing = false;
    }
  }

  install(): void {
    const onError = (event: ErrorEvent): void => {
      const target = event.target;
      if (target !== window && target instanceof Element) {
        if (target.tagName === 'AUDIO' || target.tagName === 'VIDEO') return;
        const el = target as Element & { src?: string; href?: string; currentSrc?: string };
        const url = [el.currentSrc, el.src, el.href].find(Boolean) ?? '';
        // Every <img> in this app is decorative art (cover / artist / offline blob: object-URL).
        // A failed image load is a content 404 or an evicted/revoked offline blob, never an
        // actionable client JS error — dropping all IMG resource errors keeps telemetry signal.
        if (target.tagName === 'IMG') return;
        // Third-party resources (analytics beacons, CDN widgets) fail whenever an
        // ad-blocker or privacy browser blocks them — not our bug, not actionable.
        // Same-origin failures stay: our own bundle/asset 404ing is a deploy regression.
        if (isThirdPartyUrl(url)) return;
        this.report(new Error(`Resource load failed: ${el.tagName} ${url}`), 'resource', {
          type: 'ResourceError',
        });
        return;
      }
      if (isOpaqueScriptError(event)) return;
      const rawError: unknown = event.error;
      const runtimeError = rawError instanceof Error ? rawError : new Error(event.message);
      this.report(runtimeError, 'runtime');
    };
    window.addEventListener('error', onError, true);
    this.listeners.push(() => {
      window.removeEventListener('error', onError, true);
    });

    const onRejection = (event: PromiseRejectionEvent): void => {
      this.report(event.reason, 'promise');
    };
    window.addEventListener('unhandledrejection', onRejection);
    this.listeners.push(() => {
      window.removeEventListener('unhandledrejection', onRejection);
    });

    // Typed as always present, absent in fact on an insecure origin: serviceWorker
    // is a secure-context API, and a dev build served over plain http has none.
    const swContainer = (navigator as { serviceWorker?: ServiceWorkerContainer }).serviceWorker;
    if (swContainer === undefined) return;
    const onSwMessageError = (): void => {
      this.report(new Error('Service worker message deserialization error'), 'sw', {
        type: 'ServiceWorkerMessageError',
      });
    };
    swContainer.addEventListener('messageerror', onSwMessageError);
    this.listeners.push(() => {
      swContainer.removeEventListener('messageerror', onSwMessageError);
    });
  }

  uninstall(): void {
    for (const off of this.listeners) off();
    this.listeners = [];
  }

  private isNoise(message: string, stack: string | undefined): boolean {
    // Opaque cross-origin "Script error." carries no actionable stack.
    if (message === 'Script error.' && !stack) return true;
    // Extension frames in the stack are the #1 noise source.
    if (stack && EXTENSION_FRAME.test(stack)) return true;
    // Errors thrown entirely inside a third-party script (every stack frame is a
    // foreign origin, e.g. an injected analytics beacon crashing in an old browser)
    // are that vendor's bug. A single same-origin frame keeps the report.
    if (stack && stackIsEntirelyThirdParty(stack)) return true;
    for (const pattern of this.denyList) {
      if (pattern.test(message)) return true;
    }
    return false;
  }

  private send(report: ClientTelemetryReport): void {
    try {
      // message/stack are already scrubbed field-by-field in report() before this object
      // was built. Scrubbing again here, AFTER JSON.stringify, would run the same regexes
      // over JSON syntax instead of plain text -- a secret-shaped match ending right at an
      // escaped quote (`\"`, e.g. a message that quotes a failed URL) can consume the
      // escaping backslash, turning it into a bare `"` that prematurely closes the JSON
      // string and corrupts everything after it. route is the one field that reaches here
      // unscrubbed, so scrub it individually instead of re-scrubbing the whole payload.
      const body = JSON.stringify({
        ...report,
        route: report.route ? this.scrub(report.route) : report.route,
      });
      if (new TextEncoder().encode(body).length > KEEPALIVE_BYTE_BUDGET) return;

      if (navigator.sendBeacon(this.options.endpoint, body)) return;
      void globalThis
        .fetch(this.options.endpoint, {
          method: 'POST',
          body,
          keepalive: true,
          credentials: 'same-origin',
        })
        .catch(() => {});
    } catch {
      /* transport must never throw */
    }
  }
}

export function installClientTelemetry(options: ClientTelemetryOptions): ClientTelemetryHandle {
  const telemetry = new ClientTelemetry(options);
  telemetry.install();
  return telemetry;
}

function newSessionId(): string {
  // randomUUID is secure-context only, so it is genuinely missing on an insecure
  // origin however the DOM types describe it. getRandomValues is not, hence the
  // fallback still uses the CSPRNG rather than Math.random.
  const uuid = (crypto as { randomUUID?: () => string }).randomUUID?.();
  if (uuid !== undefined) return uuid;
  const buf = crypto.getRandomValues(new Uint32Array(2));
  const rand = `${(buf[0] ?? 0).toString(36)}${(buf[1] ?? 0).toString(36)}`;
  return `sess-${Date.now().toString(36)}-${rand}`;
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return 'Error';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return String(error);
  } catch {
    return 'Unknown error';
  }
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function isThirdPartyUrl(url: string): boolean {
  if (!url) return false;
  const origin = globalThis.location.origin;
  if (origin === 'null') return false;
  try {
    return new URL(url, origin).origin !== origin;
  } catch {
    return false;
  }
}

function stackIsEntirelyThirdParty(stack: string): boolean {
  const frameUrls = stack.match(/https?:\/\/[^\s)]+/g);
  if (!frameUrls || frameUrls.length === 0) return false;
  return frameUrls.every(isThirdPartyUrl);
}

function isOpaqueScriptError(event: ErrorEvent): boolean {
  return !event.error && event.message === 'Script error.' && !event.filename;
}

const BROWSER_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/edg\//i, 'Edge'],
  [/chrome\//i, 'Chrome'],
  [/firefox\//i, 'Firefox'],
  [/safari\//i, 'Safari'],
];

const OS_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/android/i, 'Android'],
  [/iphone|ipad|ipod/i, 'iOS'],
  [/windows/i, 'Windows'],
  [/mac os/i, 'macOS'],
  [/linux/i, 'Linux'],
];

function matchLabel(value: string, patterns: ReadonlyArray<readonly [RegExp, string]>): string {
  for (const [pattern, label] of patterns) {
    if (pattern.test(value)) return label;
  }
  return 'Other';
}

function reduceUserAgent(ua: string | undefined): string | undefined {
  if (!ua) return undefined;
  return `${matchLabel(ua, BROWSER_PATTERNS)} / ${matchLabel(ua, OS_PATTERNS)}`;
}

// Fallback route when the host app never calls setRoute(): the current path,
// templatized so ids never leak (/users/42/x -> /users/:id/x). Keeps the "which
// page broke" dimension alive in every vendoring app for free.
function currentRoute(): string | undefined {
  const path = globalThis.location.pathname;
  if (path.length === 0) return undefined;
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

function fingerprintOf(category: string, type: string, message: string): string {
  const normalized = message
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b[0-9a-f]{8,}\b/gi, m => (/\d/.test(m) ? '<id>' : m))
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
  return `${category}|${type}|${hash(normalized)}`;
}

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ (input.codePointAt(i) ?? 0);
  }
  return (h >>> 0).toString(36);
}
