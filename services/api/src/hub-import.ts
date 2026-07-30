import { loadExerciseLibrary } from '@ferrum/exercise-library';
import { extractLifeAsCode, libraryResolver } from '@ferrum/importers';
import { count, eq } from 'drizzle-orm';
import { importForUser } from './bot/imports.ts';
import { type Database } from './db.ts';
import { events } from './schema.ts';

// Signing in with the hub gives a lifter an account. Without this it is an empty
// one, which reads as "the app lost my training" rather than "the app is new".
// So the first sign-in pulls the history the hub already holds and replays it
// through the same importer the Telegram path uses.

export interface HubBackfill {
  readonly outcome: 'imported' | 'already-populated' | 'nothing-to-import' | 'unavailable';
  readonly setsImported: number;
  readonly unresolved: number;
}

const NOTHING: HubBackfill = { outcome: 'nothing-to-import', setsImported: 0, unresolved: 0 };
const UNAVAILABLE: HubBackfill = { outcome: 'unavailable', setsImported: 0, unresolved: 0 };

// The hub answers with the whole history in one document; five years of it is
// about a megabyte. The ceiling is a guard against a runaway response, not a
// page size — a truncated import would look exactly like a complete one.
const REQUEST_TIMEOUT_MILLIS = 30_000;

async function hasEvents(db: Database, userId: string): Promise<boolean> {
  const [row] = await db.orm
    .select({ total: count() })
    .from(events)
    .where(eq(events.userId, userId as never));
  return (row?.total ?? 0) > 0;
}

export async function backfillFromHub(
  db: Database,
  userId: string,
  ticket: string,
  hubApiUrl: string,
  log: (message: string) => void
): Promise<HubBackfill> {
  // Only ever into an empty account. The importer is idempotent, but a device
  // that has already logged something locally owns its own history and must not
  // have the hub's copy replayed over it.
  if (await hasEvents(db, userId)) {
    return { outcome: 'already-populated', setsImported: 0, unresolved: 0 };
  }

  let response: Response;
  try {
    response = await fetch(`${hubApiUrl.replace(/\/+$/, '')}/api/federated/strength-sets`, {
      headers: { authorization: `Bearer ${ticket}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLIS),
    });
  } catch (error) {
    log(
      JSON.stringify({
        level: 'warn',
        event: 'hub_backfill_unreachable',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return UNAVAILABLE;
  }

  if (!response.ok) {
    log(JSON.stringify({ level: 'warn', event: 'hub_backfill_rejected', status: response.status }));
    return UNAVAILABLE;
  }

  let document: unknown;
  try {
    document = await response.json();
  } catch {
    log(JSON.stringify({ level: 'warn', event: 'hub_backfill_unparseable' }));
    return UNAVAILABLE;
  }

  const extraction = extractLifeAsCode(document);
  if (extraction.rows.length === 0) return NOTHING;

  const outcome = await importForUser(
    db,
    userId,
    extraction,
    libraryResolver(loadExerciseLibrary())
  );

  // Logged whatever the result: a silent partial import is the failure mode
  // that looks like success, and the unresolved count is the number that says
  // how much of a history the library could not name.
  log(
    JSON.stringify({
      level: 'info',
      event: 'hub_backfill',
      rows: extraction.rows.length,
      rejected: extraction.rejected.length,
      setsImported: outcome.result.report.setsImported,
      unresolved: outcome.result.unresolved.length,
      events: outcome.accepted,
    })
  );

  return {
    outcome: 'imported',
    setsImported: outcome.result.report.setsImported,
    unresolved: outcome.result.unresolved.length,
  };
}
