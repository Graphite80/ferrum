import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  doubleProgressionPolicy,
  linearLoadPolicy,
  replayPolicy,
  topSetBackoffPolicy,
} from '../src/index.ts';
import {
  PLAIN_EQUIPMENT,
  dpContext,
  history,
  llContext,
  session,
  tsbContext,
  type SetSpec,
} from './support/builders.ts';

const dayOf = (index: number): string => `2026-03-${String(index + 1).padStart(2, '0')}`;

const loadArb = fc.integer({ min: 1, max: 48 }).map(step => step * 2.5);

const effortArb: fc.Arbitrary<Pick<SetSpec, 'rir'>> = fc.oneof(
  fc.constant({}),
  fc.integer({ min: 0, max: 5 }).map(rir => ({ rir }))
);

const setArb: fc.Arbitrary<SetSpec> = fc
  .tuple(loadArb, fc.integer({ min: 1, max: 20 }), effortArb)
  .map(([loadKg, reps, effort]) => ({ loadKg, reps, ...effort }));

const sessionSetsArb = fc.array(setArb, { minLength: 0, maxLength: 5 });
const priorsArb = fc.array(sessionSetsArb, { minLength: 0, maxLength: 6 });

function buildScenario(priors: readonly (readonly SetSpec[])[], currentSets: readonly SetSpec[]) {
  const sessions = priors.map((sets, index) => session(dayOf(index), sets));
  const current = session(dayOf(priors.length), currentSets);
  return { hist: history(sessions), current, full: history([...sessions, current]) };
}

describe('progression properties: determinism', () => {
  it('returns deeply equal recommendations for identical inputs, for every policy', () => {
    fc.assert(
      fc.property(priorsArb, sessionSetsArb, (priors, currentSets) => {
        const { hist, current } = buildScenario(priors, currentSets);

        expect(
          doubleProgressionPolicy.evaluate(dpContext(), hist, current, PLAIN_EQUIPMENT)
        ).toStrictEqual(
          doubleProgressionPolicy.evaluate(dpContext(), hist, current, PLAIN_EQUIPMENT)
        );
        expect(
          linearLoadPolicy.evaluate(llContext(), hist, current, PLAIN_EQUIPMENT)
        ).toStrictEqual(linearLoadPolicy.evaluate(llContext(), hist, current, PLAIN_EQUIPMENT));
        expect(
          topSetBackoffPolicy.evaluate(tsbContext(), hist, current, PLAIN_EQUIPMENT)
        ).toStrictEqual(topSetBackoffPolicy.evaluate(tsbContext(), hist, current, PLAIN_EQUIPMENT));
      })
    );
  });

  it('replays a whole history to deeply equal reports on every run', () => {
    fc.assert(
      fc.property(priorsArb, sessionSetsArb, (priors, currentSets) => {
        const { full } = buildScenario(priors, currentSets);
        const replay = () =>
          replayPolicy({
            policy: doubleProgressionPolicy,
            initialPrescription: dpContext(),
            history: full,
            equipment: PLAIN_EQUIPMENT,
          });
        expect(replay()).toStrictEqual(replay());
      })
    );
  });
});

describe('progression properties: one bad session never reduces anything', () => {
  const goodSessionArb: fc.Arbitrary<SetSpec[]> = fc.array(
    fc
      .tuple(loadArb, fc.integer({ min: 8, max: 15 }))
      .map(([loadKg, reps]) => ({ loadKg, reps, rir: 2 })),
    { minLength: 3, maxLength: 3 }
  );

  const failingSessionArb: fc.Arbitrary<SetSpec[]> = fc.array(
    fc
      .tuple(loadArb, fc.integer({ min: 1, max: 4 }), effortArb)
      .map(([loadKg, reps, effort]) => ({ loadKg, reps, ...effort })),
    { minLength: 1, maxLength: 3 }
  );

  it('never emits reduce_load or reduce_sets when only the final session failed', () => {
    fc.assert(
      fc.property(
        fc.array(goodSessionArb, { minLength: 0, maxLength: 5 }),
        failingSessionArb,
        (goodSessions, failingSets) => {
          const { hist, current } = buildScenario(goodSessions, failingSets);

          const recommendations = [
            doubleProgressionPolicy.evaluate(dpContext(), hist, current, PLAIN_EQUIPMENT),
            linearLoadPolicy.evaluate(llContext(), hist, current, PLAIN_EQUIPMENT),
            topSetBackoffPolicy.evaluate(tsbContext(), hist, current, PLAIN_EQUIPMENT),
          ];
          for (const recommendation of recommendations) {
            expect(recommendation.action).not.toBe('reduce_load');
            expect(recommendation.action).not.toBe('reduce_sets');
          }
        }
      )
    );
  });
});

describe('progression properties: missing effort never reads as compliance', () => {
  const unknownEffortSessionArb: fc.Arbitrary<SetSpec[]> = fc.array(
    fc.tuple(loadArb, fc.integer({ min: 1, max: 20 })).map(([loadKg, reps]) => ({ loadKg, reps })),
    { minLength: 1, maxLength: 4 }
  );

  it('forces confidence to low and never raises the load on effort-free sessions', () => {
    fc.assert(
      fc.property(priorsArb, unknownEffortSessionArb, (priors, currentSets) => {
        const { hist, current } = buildScenario(priors, currentSets);

        const recommendations = [
          doubleProgressionPolicy.evaluate(dpContext(), hist, current, PLAIN_EQUIPMENT),
          linearLoadPolicy.evaluate(llContext(), hist, current, PLAIN_EQUIPMENT),
          topSetBackoffPolicy.evaluate(tsbContext(), hist, current, PLAIN_EQUIPMENT),
        ];
        for (const recommendation of recommendations) {
          expect(recommendation.confidence).toBe('low');
          expect(recommendation.action).not.toBe('increase_load');
        }
      })
    );
  });
});
