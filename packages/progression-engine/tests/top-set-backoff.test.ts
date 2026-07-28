import { describe, expect, it } from 'vitest';
import { kilograms, localDate } from '@ferrum/domain';
import {
  backoffLoadFromPerformedTopSet,
  policyFor,
  replayPolicy,
  topSetBackoffPolicy,
} from '../src/index.ts';
import {
  NO_INCREMENT_EQUIPMENT,
  PLAIN_EQUIPMENT,
  TSB_RULE,
  comparableSet,
  equipmentInstance,
  history,
  painExclusion,
  session,
  tsbContext,
} from './support/builders.ts';

const evaluate = topSetBackoffPolicy.evaluate.bind(topSetBackoffPolicy);

const metAtRpe8 = [
  { loadKg: 100, reps: 5, rpe: 8 },
  { loadKg: 80, reps: 7, rpe: 7 },
  { loadKg: 80, reps: 7, rpe: 7 },
];

describe('policy registry', () => {
  it('routes top_set_backoff rules to the top set back-off policy', () => {
    expect(policyFor(TSB_RULE)).toBe(topSetBackoffPolicy);
  });
});

describe('top set back-off: insufficient data', () => {
  it('refuses to guess when no session was performed', () => {
    const result = evaluate(tsbContext(), history([]), null, PLAIN_EQUIPMENT);
    expect(result.action).toBe('insufficient_data');
    expect(result.proposedPrescription).toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('refuses to guess when no comparable set survived exclusion', () => {
    const current = session('2026-07-08', [], [painExclusion('2026-07-08', 1)]);
    const result = evaluate(tsbContext(), history([]), current, PLAIN_EQUIPMENT);
    expect(result.action).toBe('insufficient_data');
    expect(result.explanation).toContain('No comparable set survived exclusion');
  });
});

describe('top set back-off: pain', () => {
  it('sends pain level 2 to exercise review', () => {
    const current = session('2026-07-08', metAtRpe8, [painExclusion('2026-07-08', 2)]);
    const result = evaluate(tsbContext(), history([]), current, PLAIN_EQUIPMENT);
    expect(result.action).toBe('review_exercise');
    expect(result.reasonCodes).toContain('pain_reported');
  });

  it('surfaces a pain level 1 flag as a warning while still deciding', () => {
    const current = session('2026-07-08', metAtRpe8, [painExclusion('2026-07-08', 1)]);
    const result = evaluate(tsbContext(), history([]), current, PLAIN_EQUIPMENT);
    expect(result.action).toBe('increase_load');
    expect(result.warnings.some(warning => warning.includes('pain flag'))).toBe(true);
  });
});

describe('top set back-off: missed top set reps', () => {
  const missedTop = [
    { loadKg: 100, reps: 4, rpe: 9 },
    { loadKg: 80, reps: 7, rpe: 8 },
  ];

  it('repeats after one missed top set instead of deloading', () => {
    const result = evaluate(
      tsbContext(),
      history([]),
      session('2026-07-08', missedTop),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('repeat');
    expect(result.reasonCodes).toContain('top_set_reps_missed');
    expect(result.reasonCodes).not.toContain('repeated_failure');
    expect(result.proposedPrescription?.sets[0]?.targetLoadKg).toBe(kilograms(100));
  });

  it('reduces the top set after two missed sessions in a row', () => {
    const result = evaluate(
      tsbContext(),
      history([session('2026-07-01', missedTop)]),
      session('2026-07-08', missedTop),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('reduce_load');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['top_set_reps_missed', 'repeated_failure'])
    );
    expect(result.proposedPrescription?.sets[0]?.targetLoadKg).toBe(kilograms(90));
    expect(result.proposedPrescription?.sets[1]?.targetLoadKg).toBe(kilograms(70));
  });

  it('asks for an exercise review when the equipment cannot go lower', () => {
    const equipment = {
      instance: equipmentInstance({
        stackIncrementKg: kilograms(25),
        stackMinimumKg: kilograms(100),
      }),
      definitionDefaultIncrementKg: null,
    };
    const result = evaluate(
      tsbContext(),
      history([session('2026-07-01', missedTop)]),
      session('2026-07-08', missedTop),
      equipment
    );
    expect(result.action).toBe('review_exercise');
    expect(result.reasonCodes).toContain('cannot_reduce_further');
  });
});

describe('top set back-off: effort on the top set', () => {
  it('holds when the top set carries no RPE, and says the load was not earned down or up', () => {
    const noEffort = [
      { loadKg: 100, reps: 5 },
      { loadKg: 80, reps: 7 },
    ];
    const result = evaluate(
      tsbContext(),
      history([]),
      session('2026-07-08', noEffort),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['top_set_reps_met', 'effort_unknown'])
    );
    expect(result.confidence).toBe('low');
  });

  it('holds after a single top set above the target RPE', () => {
    const overshot = [{ loadKg: 100, reps: 5, rpe: 9.5 }];
    const result = evaluate(
      tsbContext(),
      history([]),
      session('2026-07-08', overshot),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toContain('top_set_effort_above_target');
  });

  it('reduces the load after two sessions bought with effort above target', () => {
    const overshot = [{ loadKg: 100, reps: 5, rpe: 9.5 }];
    const result = evaluate(
      tsbContext(),
      history([session('2026-07-01', overshot)]),
      session('2026-07-08', overshot),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('reduce_load');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        'top_set_reps_met',
        'top_set_effort_above_target',
        'repeated_failure',
      ])
    );
    expect(result.proposedPrescription?.sets[0]?.targetLoadKg).toBe(kilograms(90));
  });

  it('holds when effort is above target twice but the equipment cannot go lower', () => {
    const overshot = [{ loadKg: 100, reps: 5, rpe: 9.5 }];
    const equipment = {
      instance: equipmentInstance({
        stackIncrementKg: kilograms(25),
        stackMinimumKg: kilograms(100),
      }),
      definitionDefaultIncrementKg: null,
    };
    const result = evaluate(
      tsbContext(),
      history([session('2026-07-01', overshot)]),
      session('2026-07-08', overshot),
      equipment
    );
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toContain('top_set_effort_above_target');
  });

  it('reads RIR entries through the RIR-anchored RPE mapping', () => {
    const viaRir = [{ loadKg: 100, reps: 5, rir: 2 }];
    const result = evaluate(
      tsbContext(),
      history([]),
      session('2026-07-08', viaRir),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('increase_load');
  });
});

describe('top set back-off: earned increase and its anchors', () => {
  it('holds and asks for equipment configuration when no increment is known', () => {
    const result = evaluate(
      tsbContext(),
      history([]),
      session('2026-07-08', metAtRpe8),
      NO_INCREMENT_EQUIPMENT
    );
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toContain('increment_unknown');
  });

  it('holds when readiness is reported low', () => {
    const result = evaluate(
      tsbContext(),
      history([]),
      session('2026-07-08', metAtRpe8),
      PLAIN_EQUIPMENT,
      {
        readiness: 'low',
      }
    );
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toContain('readiness_low');
  });

  it('holds at the equipment maximum', () => {
    const equipment = {
      instance: equipmentInstance({
        stackIncrementKg: kilograms(2.5),
        maximumLoadKg: kilograms(100),
      }),
      definitionDefaultIncrementKg: null,
    };
    const result = evaluate(tsbContext(), history([]), session('2026-07-08', metAtRpe8), equipment);
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toContain('equipment_maximum_reached');
  });

  it('raises the top set but anchors every back-off set to the load actually lifted', () => {
    const result = evaluate(
      tsbContext(),
      history([]),
      session('2026-07-08', metAtRpe8),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('increase_load');

    const proposal = result.proposedPrescription;
    expect(proposal?.sets).toHaveLength(1 + TSB_RULE.backoff.sets);
    expect(proposal?.sets[0]?.setType).toBe('top');
    expect(proposal?.sets[0]?.targetLoadKg).toBe(kilograms(102.5));
    expect(proposal?.sets[0]?.targetRpe).toBe(8);

    const performedTopSet = comparableSet(
      localDate('2026-07-08'),
      0,
      metAtRpe8[0] ?? { loadKg: 100, reps: 5 }
    );
    const anchored = backoffLoadFromPerformedTopSet(performedTopSet, TSB_RULE, PLAIN_EQUIPMENT);
    expect(anchored).toBe(kilograms(80));
    for (const backoffSet of proposal?.sets.slice(1) ?? []) {
      expect(backoffSet.setType).toBe('backoff');
      expect(backoffSet.targetLoadKg).toBe(anchored);
      expect(backoffSet.targetRepMin).toBe(7);
    }
  });

  it('anchors the back-off to the performed top set, not the prescribed target', () => {
    const underPlan = [
      { loadKg: 95, reps: 5, rpe: 8 },
      { loadKg: 75, reps: 7, rpe: 7 },
    ];
    const prescription = tsbContext({}, 100);
    const result = evaluate(
      prescription,
      history([]),
      session('2026-07-08', underPlan),
      PLAIN_EQUIPMENT
    );

    const performedTopSet = comparableSet(
      localDate('2026-07-08'),
      0,
      underPlan[0] ?? { loadKg: 95, reps: 5 }
    );
    const anchored = backoffLoadFromPerformedTopSet(performedTopSet, TSB_RULE, PLAIN_EQUIPMENT);
    expect(anchored).toBe(kilograms(75));
    for (const backoffSet of result.proposedPrescription?.sets.slice(1) ?? []) {
      expect(backoffSet.targetLoadKg).toBe(anchored);
    }
    expect(result.explanation).toContain('actually lifted');
  });
});

describe('top set back-off: replayed over a top-plus-back-off history', () => {
  it('sees prior top-set sessions despite their lighter back-off work, and counts the stall honestly', () => {
    const passing = session('2026-07-01', [
      { loadKg: 100, reps: 5, rpe: 8 },
      { loadKg: 80, reps: 7, rpe: 7 },
      { loadKg: 80, reps: 7, rpe: 7 },
    ]);
    const firstMiss = session('2026-07-08', [
      { loadKg: 100, reps: 4, rpe: 9 },
      { loadKg: 80, reps: 7, rpe: 8 },
    ]);
    const secondMiss = session('2026-07-15', [
      { loadKg: 100, reps: 4, rpe: 9 },
      { loadKg: 80, reps: 7, rpe: 8 },
    ]);

    const report = replayPolicy({
      policy: topSetBackoffPolicy,
      initialPrescription: tsbContext({}, 100),
      history: history([passing, firstMiss, secondMiss]),
      equipment: PLAIN_EQUIPMENT,
    });

    expect(report.steps.map(step => step.recommendation.action)).toEqual([
      'increase_load',
      'repeat',
      'reduce_load',
    ]);
    expect(report.steps[2]?.failingSessionsEndingHere).toBe(2);
    expect(report.reductionsAfterSingleBadSession).toBe(0);
  });
});
