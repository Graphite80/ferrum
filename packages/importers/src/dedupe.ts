import type { ComparisonSignature, LocalDate, SessionId } from '@ferrum/domain';
import type { ImportSourceId, NormalizedSetRow, UnresolvedRow } from './model.ts';

export function importRecordKey(source: ImportSourceId, sourceRecordId: string): string {
  return `${source}::${sourceRecordId}`;
}

export interface ExistingSessionSummary {
  readonly sessionId: SessionId;
  readonly localDate: LocalDate;
  readonly signatures: readonly ComparisonSignature[];
}

export interface IncomingSessionSummary {
  readonly sessionKey: string;
  readonly localDate: LocalDate;
  readonly signatures: readonly ComparisonSignature[];
}

export interface ExistingHistory {
  readonly importedRecordKeys: ReadonlySet<string>;
  readonly sessions: readonly ExistingSessionSummary[];
}

export const EMPTY_HISTORY: ExistingHistory = {
  importedRecordKeys: new Set<string>(),
  sessions: [],
};

export type DuplicateResolutionChoice = 'skip' | 'import_as_separate' | 'merge';

export const DUPLICATE_RESOLUTION_CHOICES: readonly DuplicateResolutionChoice[] = [
  'skip',
  'import_as_separate',
  'merge',
];

export const DUPLICATE_OVERLAP_THRESHOLD = 0.7;

export interface DuplicateSessionCandidate {
  readonly incomingSessionKey: string;
  readonly existingSessionId: SessionId;
  readonly localDate: LocalDate;
  readonly overlapRatio: number;
  readonly matchedSignatureCount: number;
  readonly incomingSignatureCount: number;
  readonly choices: readonly DuplicateResolutionChoice[];
}

export interface RowPartition {
  readonly fresh: readonly NormalizedSetRow[];
  readonly duplicates: readonly UnresolvedRow[];
}

// Hard idempotency. A re-import of the same export must add nothing, and the only
// fact strong enough to guarantee that is the id the source itself assigned. Rows
// with no such id would need heuristics, so sources that lack one synthesise a
// content-derived id instead of falling back to "looks similar".
export function partitionByRecordIdempotency(
  source: ImportSourceId,
  rows: readonly NormalizedSetRow[],
  alreadyImported: ReadonlySet<string>
): RowPartition {
  const fresh: NormalizedSetRow[] = [];
  const duplicates: UnresolvedRow[] = [];
  const seenInBatch = new Set<string>();

  for (const row of rows) {
    const key = importRecordKey(source, row.sourceRecordId);
    if (alreadyImported.has(key)) {
      duplicates.push({
        sourceRecordId: row.sourceRecordId,
        reason: 'duplicate_source_record',
        detail: `${key} was imported before; the earlier copy is kept`,
        originalPayload: row.originalPayload,
      });
      continue;
    }
    if (seenInBatch.has(key)) {
      duplicates.push({
        sourceRecordId: row.sourceRecordId,
        reason: 'duplicate_source_record',
        detail: `${key} appears more than once in this file; the first copy is kept`,
        originalPayload: row.originalPayload,
      });
      continue;
    }
    seenInBatch.add(key);
    fresh.push(row);
  }

  return { fresh, duplicates };
}

// The soft check for the same workout arriving under a new id — a second export, an
// app migration, a manual re-entry. It is deliberately only a flag: two genuinely
// different sessions on one day are common enough (morning and evening, or a repeated
// circuit) that auto-removal would destroy real training history to save a click.
export function findLikelyDuplicateSessions(
  incoming: readonly IncomingSessionSummary[],
  existing: readonly ExistingSessionSummary[],
  threshold = DUPLICATE_OVERLAP_THRESHOLD
): DuplicateSessionCandidate[] {
  const byDate = new Map<LocalDate, ExistingSessionSummary[]>();
  for (const session of existing) {
    const bucket = byDate.get(session.localDate) ?? [];
    bucket.push(session);
    byDate.set(session.localDate, bucket);
  }

  const candidates: DuplicateSessionCandidate[] = [];
  for (const session of incoming) {
    if (session.signatures.length === 0) continue;
    for (const other of byDate.get(session.localDate) ?? []) {
      const matched = countMatchingSignatures(session.signatures, other.signatures);
      const ratio = matched / session.signatures.length;
      if (ratio < threshold) continue;
      candidates.push({
        incomingSessionKey: session.sessionKey,
        existingSessionId: other.sessionId,
        localDate: session.localDate,
        overlapRatio: ratio,
        matchedSignatureCount: matched,
        incomingSignatureCount: session.signatures.length,
        choices: DUPLICATE_RESOLUTION_CHOICES,
      });
    }
  }

  return candidates;
}

function countMatchingSignatures(
  incoming: readonly ComparisonSignature[],
  existing: readonly ComparisonSignature[]
): number {
  const available = new Map<ComparisonSignature, number>();
  for (const signature of existing) {
    available.set(signature, (available.get(signature) ?? 0) + 1);
  }

  let matched = 0;
  for (const signature of incoming) {
    const remaining = available.get(signature) ?? 0;
    if (remaining > 0) {
      available.set(signature, remaining - 1);
      matched += 1;
    }
  }
  return matched;
}
