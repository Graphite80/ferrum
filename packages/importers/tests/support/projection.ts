import { projectSession, type DomainEvent, type SessionId, type WorkoutSet } from '@ferrum/domain';
import type { ImportResult } from '../../src/index.ts';

export function eventsBySession(events: readonly DomainEvent[]): Map<SessionId, DomainEvent[]> {
  const bySession = new Map<SessionId, DomainEvent[]>();
  for (const event of events) {
    const bucket = bySession.get(event.aggregateId) ?? [];
    bucket.push(event);
    bySession.set(event.aggregateId, bucket);
  }
  return bySession;
}

// Every assertion about what was imported reads the projection rather than the emitted
// events, because the projection is what the app will actually show. Anything the
// importer sets that does not survive replay is not imported, it is decoration.
export function projectAll(result: ImportResult): WorkoutSet[] {
  const sets: WorkoutSet[] = [];
  for (const [sessionId, events] of eventsBySession(result.events)) {
    sets.push(...projectSession(sessionId, events).sets);
  }
  return sets;
}
