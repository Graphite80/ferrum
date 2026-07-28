import {
  projectSession,
  type DomainEvent,
  type SessionId,
  type SessionProjection,
  type WorkoutSet,
} from '@ferrum/domain';
import {
  importedRecordKeysOf,
  type ExistingHistory,
  type ExistingSessionSummary,
} from '@ferrum/importers';

export function projectAllSessions(
  events: readonly DomainEvent[]
): Map<SessionId, SessionProjection> {
  const bySession = new Map<SessionId, DomainEvent[]>();
  for (const event of events) {
    const sessionId = event.aggregateId;
    const bucket = bySession.get(sessionId) ?? [];
    bucket.push(event);
    bySession.set(sessionId, bucket);
  }
  const projections = new Map<SessionId, SessionProjection>();
  for (const [sessionId, sessionEvents] of bySession) {
    projections.set(sessionId, projectSession(sessionId, sessionEvents));
  }
  return projections;
}

export function existingHistoryOf(events: readonly DomainEvent[]): ExistingHistory {
  const sessions: ExistingSessionSummary[] = [];
  for (const [sessionId, projection] of projectAllSessions(events)) {
    if (projection.session == null) continue;
    sessions.push({
      sessionId,
      localDate: projection.session.localDate,
      signatures: projection.sets.map(set => set.comparisonSignature),
    });
  }
  return { importedRecordKeys: importedRecordKeysOf({ events }), sessions };
}

export function allProjectedSets(events: readonly DomainEvent[]): WorkoutSet[] {
  const sets: WorkoutSet[] = [];
  for (const projection of projectAllSessions(events).values()) {
    sets.push(...projection.sets);
  }
  return sets;
}

export function latestFinishedSession(events: readonly DomainEvent[]): SessionProjection | null {
  let latest: SessionProjection | null = null;
  for (const projection of projectAllSessions(events).values()) {
    if (projection.session?.status !== 'finished') continue;
    if (latest?.session == null || projection.session.startedAt > latest.session.startedAt) {
      latest = projection;
    }
  }
  return latest;
}
