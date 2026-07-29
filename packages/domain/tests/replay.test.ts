import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  type DeviceId,
  type DomainEvent,
  type EventId,
  type SessionProjection,
  type WorkoutSetId,
  EVENT_SCHEMA_VERSION,
  buildEvent,
  instant,
  projectSession,
  sortEvents,
} from '../src/index.ts';
import { SESSION_ID, USER_ID, scriptedSessionArbitrary } from '../src/testing/factories.ts';

function substantive(projection: SessionProjection) {
  return {
    session: projection.session,
    exercises: projection.exercises,
    sets: projection.sets,
    deletedSets: projection.deletedSets,
    supersetGroups: projection.supersetGroups,
  };
}

function permute(events: readonly DomainEvent[], seed: number): DomainEvent[] {
  const shuffled = [...events];
  let state = seed || 1;
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    const a = shuffled[i];
    const b = shuffled[j];
    if (a === undefined || b === undefined) continue;
    shuffled[i] = b;
    shuffled[j] = a;
  }
  return shuffled;
}

describe('session replay determinism', () => {
  it('produces an identical projection regardless of the order events arrive in', () => {
    fc.assert(
      fc.property(
        scriptedSessionArbitrary,
        fc.integer({ min: 1, max: 1_000_000 }),
        (session, seed) => {
          const canonical = projectSession(SESSION_ID, session.events);
          const shuffled = projectSession(SESSION_ID, permute(session.events, seed));
          expect(substantive(shuffled)).toStrictEqual(substantive(canonical));
        }
      ),
      { numRuns: 300 }
    );
  });

  it('is idempotent under duplicated delivery of the whole log', () => {
    fc.assert(
      fc.property(scriptedSessionArbitrary, session => {
        const once = projectSession(SESSION_ID, session.events);
        const twice = projectSession(SESSION_ID, [...session.events, ...session.events]);
        expect(substantive(twice)).toStrictEqual(substantive(once));
      }),
      { numRuns: 200 }
    );
  });

  it('is idempotent under a partially replayed batch, as a retried push would deliver', () => {
    fc.assert(
      fc.property(scriptedSessionArbitrary, fc.integer({ min: 0, max: 40 }), (session, cut) => {
        const overlap = session.events.slice(0, Math.min(cut, session.events.length));
        const once = projectSession(SESSION_ID, session.events);
        const retried = projectSession(SESSION_ID, [...overlap, ...session.events, ...overlap]);
        expect(substantive(retried)).toStrictEqual(substantive(once));
      }),
      { numRuns: 200 }
    );
  });

  it('never loses a logged set: every SetLogged id is present as live or tombstoned', () => {
    fc.assert(
      fc.property(scriptedSessionArbitrary, session => {
        const projection = projectSession(SESSION_ID, session.events);
        const surfaced = new Set<WorkoutSetId>([
          ...projection.sets.map(set => set.id),
          ...projection.deletedSets.map(set => set.id),
        ]);
        const logged = session.events
          .filter(event => event.eventType === 'SetLogged')
          .map(event => event.payload.setId);
        for (const setId of logged) {
          expect(surfaced.has(setId)).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('assigns a contiguous zero-based order index to live exercises', () => {
    fc.assert(
      fc.property(scriptedSessionArbitrary, session => {
        const projection = projectSession(SESSION_ID, session.events);
        projection.exercises.forEach((exercise, index) => {
          expect(exercise.orderIndex).toBe(index);
        });
      }),
      { numRuns: 200 }
    );
  });

  it('keeps every logged set in the projection after the whole session is deleted', () => {
    fc.assert(
      fc.property(scriptedSessionArbitrary, session => {
        const lastWall = Math.max(0, ...session.events.map(event => event.hlc.wallMillis));
        const tombstone = buildEvent(
          'SessionDeleted',
          { sessionId: SESSION_ID, reason: 'mislogged' },
          {
            eventId: 'evt-session-delete' as EventId,
            aggregateId: SESSION_ID,
            userId: USER_ID,
            deviceId: 'phone' as DeviceId,
            schemaVersion: EVENT_SCHEMA_VERSION,
            hlc: { wallMillis: lastWall + 1, counter: 0, nodeId: 'phone' },
            clientCreatedAt: instant(lastWall + 1),
            serverReceivedAt: null,
            serverSequence: null,
          }
        );
        const projection = projectSession(SESSION_ID, [...session.events, tombstone]);
        expect(projection.session?.deleted).toBe(true);
        const surfaced = new Set<WorkoutSetId>([
          ...projection.sets.map(set => set.id),
          ...projection.deletedSets.map(set => set.id),
        ]);
        const logged = session.events
          .filter(event => event.eventType === 'SetLogged')
          .map(event => event.payload.setId);
        for (const setId of logged) {
          expect(surfaced.has(setId)).toBe(true);
        }
        // The tombstone flips exactly one flag; sets, exercises and set tombstones are untouched.
        const withoutTombstone = projectSession(SESSION_ID, session.events);
        expect({ ...substantive(projection), session: null }).toStrictEqual({
          ...substantive(withoutTombstone),
          session: null,
        });
      }),
      { numRuns: 200 }
    );
  });

  it('converges delete → restore → delete on the last tombstone in total order, under permutation', () => {
    fc.assert(
      fc.property(
        scriptedSessionArbitrary,
        fc.integer({ min: 1, max: 1_000_000 }),
        (session, seed) => {
          const canonical = projectSession(SESSION_ID, session.events);
          const shuffled = projectSession(SESSION_ID, permute(session.events, seed));
          expect(shuffled.session?.deleted).toBe(canonical.session?.deleted);

          if (canonical.session == null) return;
          const lastTombstone = sortEvents(session.events)
            .filter(
              event => event.eventType === 'SessionDeleted' || event.eventType === 'SessionRestored'
            )
            .pop();
          expect(canonical.session.deleted).toBe(lastTombstone?.eventType === 'SessionDeleted');
        }
      ),
      { numRuns: 200 }
    );
  });

  it('reports events belonging to another session instead of silently applying them', () => {
    fc.assert(
      fc.property(scriptedSessionArbitrary, session => {
        const foreign = projectSession('other-session' as typeof SESSION_ID, session.events);
        expect(foreign.anomalies.length).toBe(session.events.length);
        expect(foreign.appliedEventCount).toBe(0);
        expect(foreign.session).toBeNull();
      }),
      { numRuns: 50 }
    );
  });
});
