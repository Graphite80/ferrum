import { projectAll, type DomainEvent, type SessionProjection } from '@ferrum/domain';
import {
  importedRecordKeysOf,
  type ExistingHistory,
  type ExistingSessionSummary,
} from '@ferrum/importers';

export function existingHistoryOf(events: readonly DomainEvent[]): ExistingHistory {
  const sessions: ExistingSessionSummary[] = [];
  for (const [sessionId, projection] of projectAll(events)) {
    if (projection.session == null || projection.session.deleted) continue;
    sessions.push({
      sessionId,
      localDate: projection.session.localDate,
      signatures: projection.sets.map(set => set.comparisonSignature),
    });
  }
  return { importedRecordKeys: importedRecordKeysOf({ events }), sessions };
}

export function latestFinishedSession(events: readonly DomainEvent[]): SessionProjection | null {
  let latest: SessionProjection | null = null;
  for (const projection of projectAll(events).values()) {
    if (projection.session?.status !== 'finished' || projection.session.deleted) continue;
    if (latest?.session == null || projection.session.startedAt > latest.session.startedAt) {
      latest = projection;
    }
  }
  return latest;
}
