import { createHmac } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { isWorkingSet, projectSession, type DomainEvent, type SessionId } from '@ferrum/domain';
import { loadExerciseLibrary } from '@ferrum/exercise-library';
import { type Database } from './db.ts';
import { events, userIdentities } from './schema.ts';
import { rowToEvent } from './sync.ts';
import { SSO_PROVIDER } from './sso.ts';

// The return leg of the integration. The hub is where training data is analysed,
// so a workout logged here has to arrive there — otherwise the hub goes stale
// the moment a lifter stops using the importer it used to be fed by.

// A separate audience from the read ticket on purpose: the read ticket is handed
// to a browser as a cookie and therefore leaves the domain, so it must not also
// authorise a write.
const INGEST_AUDIENCE = 'life-as-code-ingest';
const INGEST_ISSUER = 'ferrum';
const TICKET_LIFETIME_SECONDS = 300;
const REQUEST_TIMEOUT_MILLIS = 20_000;

export interface HubExportRow {
  readonly date: string;
  readonly exercise: string;
  readonly set_index: number;
  readonly weight_kg: number | null;
  readonly reps: number | null;
  readonly rpe: number | null;
  readonly duration_seconds: number | null;
  readonly distance_meters: number | null;
  readonly set_type: string;
}

function b64url(raw: Buffer): string {
  return raw.toString('base64url');
}

export function mintIngestTicket(signingKey: string, subject: string, nowMillis: number): string {
  const issuedAt = Math.floor(nowMillis / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        iss: INGEST_ISSUER,
        aud: INGEST_AUDIENCE,
        sub: subject,
        iat: issuedAt,
        exp: issuedAt + TICKET_LIFETIME_SECONDS,
      })
    )
  );
  const signed = `${header}.${payload}`;
  return `${signed}.${createHmac('sha256', signingKey).update(signed).digest('base64url')}`;
}

// The hub keys a set on (date, exercise, set_index), so the export has to
// produce that shape. set_index counts within one exercise on one day, which is
// what makes a re-push an update rather than a duplicate.
export function rowsForSession(
  sessionEvents: readonly DomainEvent[],
  sessionId: SessionId
): readonly HubExportRow[] {
  const projection = projectSession(sessionId, sessionEvents);
  const session = projection.session;
  // Only finished, undeleted workouts travel: a session still being logged would
  // arrive at the hub a set at a time and read as many tiny workouts.
  if (session === null || session.status !== 'finished' || session.deleted) return [];

  const library = loadExerciseLibrary();
  const nameFor = new Map<string, string>();
  for (const exercise of projection.exercises) {
    const definition = library.byId.get(exercise.exerciseDefinitionId);
    nameFor.set(exercise.id, definition?.name ?? String(exercise.exerciseDefinitionId));
  }

  const indexByExercise = new Map<string, number>();
  const rows: HubExportRow[] = [];
  for (const set of projection.sets) {
    const exercise = nameFor.get(set.sessionExerciseId);
    if (exercise === undefined) continue;
    const next = indexByExercise.get(exercise) ?? 0;
    indexByExercise.set(exercise, next + 1);
    const measurements = set.measurements;
    rows.push({
      date: String(session.localDate),
      exercise,
      set_index: next,
      weight_kg: measurements.canonicalExternalLoadKg ?? null,
      reps: measurements.reps ?? null,
      // The hub stores RPE; this app records RIR, and 10 - RIR is the same
      // statement the importer makes in the other direction.
      rpe: measurements.rirEntered == null ? null : 10 - measurements.rirEntered,
      duration_seconds: measurements.durationSeconds ?? null,
      distance_meters: measurements.distanceMeters ?? null,
      // Warmups are marked rather than dropped: the hub excludes them from its
      // own analysis, and silently sending them as working sets would inflate
      // every volume figure it computes.
      set_type: isWorkingSet(set) ? 'normal' : set.setType,
    });
  }
  return rows;
}

async function hubSubjectFor(db: Database, userId: string): Promise<string | null> {
  const found = await db.orm
    .select({ providerUid: userIdentities.providerUid })
    .from(userIdentities)
    .where(and(eq(userIdentities.userId, userId), eq(userIdentities.provider, SSO_PROVIDER)));
  return found[0]?.providerUid ?? null;
}

export interface HubExportResult {
  readonly outcome: 'pushed' | 'nothing-to-push' | 'not-linked' | 'unavailable';
  readonly sets: number;
}

export async function exportSessionsToHub(
  db: Database,
  userId: string,
  sessionIds: readonly SessionId[],
  signingKey: string,
  hubApiUrl: string,
  log: (message: string) => void,
  nowMillis: number
): Promise<HubExportResult> {
  if (sessionIds.length === 0) return { outcome: 'nothing-to-push', sets: 0 };

  // Only an account that came from the hub has somewhere to push to. A local
  // or bootstrap account is not an error, it simply has no counterpart.
  const subject = await hubSubjectFor(db, userId);
  if (subject === null) return { outcome: 'not-linked', sets: 0 };

  const stored = await db.orm
    .select()
    .from(events)
    .where(
      and(eq(events.userId, userId as never), inArray(events.aggregateId, sessionIds as never))
    );

  const bySession = new Map<string, DomainEvent[]>();
  for (const row of [...stored].sort((a, b) => a.serverSequence - b.serverSequence)) {
    const list = bySession.get(row.aggregateId) ?? [];
    list.push(rowToEvent(row));
    bySession.set(row.aggregateId, list);
  }

  const rows: HubExportRow[] = [];
  for (const [sessionId, sessionEvents] of bySession) {
    rows.push(...rowsForSession(sessionEvents, sessionId as SessionId));
  }
  if (rows.length === 0) return { outcome: 'nothing-to-push', sets: 0 };

  let response: Response;
  try {
    response = await fetch(`${hubApiUrl.replace(/\/+$/, '')}/api/federated/strength-sets`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${mintIngestTicket(signingKey, subject, nowMillis)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sets: rows }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLIS),
    });
  } catch (error) {
    log(
      JSON.stringify({
        level: 'warn',
        event: 'hub_export_unreachable',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return { outcome: 'unavailable', sets: rows.length };
  }

  if (!response.ok) {
    log(JSON.stringify({ level: 'warn', event: 'hub_export_rejected', status: response.status }));
    return { outcome: 'unavailable', sets: rows.length };
  }

  log(
    JSON.stringify({
      level: 'info',
      event: 'hub_export',
      sessions: bySession.size,
      sets: rows.length,
    })
  );
  return { outcome: 'pushed', sets: rows.length };
}
