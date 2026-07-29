import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  type DomainEvent,
  type SessionId,
  allSets,
  projectAll,
  projectSession,
} from '../src/index.ts';
import { scriptedSessionArbitrary, type ScriptedSession } from '../src/testing/factories.ts';

function retarget(session: ScriptedSession, sessionId: SessionId): DomainEvent[] {
  return session.events.map(
    event =>
      ({
        ...event,
        eventId: `${event.eventId}@${sessionId}`,
        aggregateId: sessionId,
        payload:
          'sessionId' in event.payload ? { ...event.payload, sessionId } : { ...event.payload },
      }) as DomainEvent
  );
}

function interleave(logs: readonly (readonly DomainEvent[])[]): DomainEvent[] {
  const cursors = logs.map(() => 0);
  const merged: DomainEvent[] = [];
  for (let step = 0; merged.length < logs.reduce((sum, log) => sum + log.length, 0); step += 1) {
    const index = step % logs.length;
    const log = logs[index];
    const cursor = cursors[index];
    if (log === undefined || cursor === undefined || cursor >= log.length) continue;
    const event = log[cursor];
    if (event !== undefined) merged.push(event);
    cursors[index] = cursor + 1;
  }
  return merged;
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

const multiSessionArbitrary: fc.Arbitrary<DomainEvent[]> = fc
  .array(scriptedSessionArbitrary, { minLength: 1, maxLength: 3 })
  .map(sessions =>
    interleave(
      sessions.map((session, index) =>
        retarget(session, `session-${String(index + 1)}` as SessionId)
      )
    )
  );

describe('projecting a mixed multi-session log', () => {
  it('projects each session exactly as a per-session filter-and-project would', () => {
    fc.assert(
      fc.property(multiSessionArbitrary, events => {
        const projections = projectAll(events);
        const sessionIds = [...new Set(events.map(event => event.aggregateId))];
        expect([...projections.keys()]).toStrictEqual(sessionIds);
        for (const sessionId of sessionIds) {
          const expected = projectSession(
            sessionId,
            events.filter(event => event.aggregateId === sessionId)
          );
          expect(projections.get(sessionId)).toStrictEqual(expected);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('produces identical per-session projections regardless of arrival order', () => {
    fc.assert(
      fc.property(multiSessionArbitrary, fc.integer({ min: 1, max: 1_000_000 }), (events, seed) => {
        const canonical = projectAll(events);
        const shuffled = projectAll(permute(events, seed));
        expect(new Set(shuffled.keys())).toStrictEqual(new Set(canonical.keys()));
        for (const [sessionId, projection] of canonical) {
          expect(shuffled.get(sessionId)).toStrictEqual(projection);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('concatenates the live sets of every projection in session order, losing none', () => {
    fc.assert(
      fc.property(multiSessionArbitrary, fc.integer({ min: 1, max: 1_000_000 }), (events, seed) => {
        const sets = allSets(events);
        // A tombstoned session's sets stop counting: they stay in the log and in
        // projectAll, but never in the training record allSets describes.
        expect(sets).toStrictEqual(
          [...projectAll(events).values()]
            .filter(projection => projection.session?.deleted !== true)
            .flatMap(projection => projection.sets)
        );
        const shuffledSets = allSets(permute(events, seed));
        const serialize = (items: readonly unknown[]) =>
          items.map(item => JSON.stringify(item)).sort();
        expect(serialize(shuffledSets)).toStrictEqual(serialize(sets));
      }),
      { numRuns: 100 }
    );
  });
});
