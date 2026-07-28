import { describe, expect, it } from 'vitest';
import { kilograms } from '@ferrum/domain';
import { doubleProgressionPolicy, policyFor } from '../src/index.ts';
import {
  DP_RULE,
  NO_INCREMENT_EQUIPMENT,
  PLAIN_EQUIPMENT,
  dpContext,
  equipmentInstance,
  history,
  painExclusion,
  session,
  warmupExclusion,
} from './support/builders.ts';

const evaluate = doubleProgressionPolicy.evaluate.bind(doubleProgressionPolicy);

describe('policy registry', () => {
  it('routes double_progression rules to the double progression policy', () => {
    expect(policyFor(DP_RULE)).toBe(doubleProgressionPolicy);
  });
});

describe('double progression: insufficient data', () => {
  it('refuses to guess when no session was performed', () => {
    const result = evaluate(dpContext(), history([]), null, PLAIN_EQUIPMENT);
    expect(result.action).toBe('insufficient_data');
    expect(result.proposedPrescription).toBeNull();
    expect(result.reasonCodes).toContain('no_comparable_sets');
    expect(result.confidence).toBe('low');
  });

  it('refuses to guess when every set of the session was excluded, and names the reasons', () => {
    const current = session(
      '2026-07-01',
      [],
      [painExclusion('2026-07-01', 1), warmupExclusion('2026-07-01')]
    );
    const result = evaluate(dpContext(), history([]), current, PLAIN_EQUIPMENT);
    expect(result.action).toBe('insufficient_data');
    expect(result.proposedPrescription).toBeNull();
    expect(result.explanation).toContain('pain_flagged');
    expect(result.explanation).toContain('warmup_or_technique');
  });
});

describe('double progression: pain', () => {
  it('sends pain level 2 to exercise review instead of adjusting load', () => {
    const current = session(
      '2026-07-01',
      [{ loadKg: 60, reps: 10, rir: 2 }],
      [painExclusion('2026-07-01', 2)]
    );
    const result = evaluate(dpContext(), history([]), current, PLAIN_EQUIPMENT);
    expect(result.action).toBe('review_exercise');
    expect(result.reasonCodes).toContain('pain_reported');
    expect(result.proposedPrescription).toBeNull();
    expect(result.confidence).toBe('high');
  });

  it('surfaces a pain level 1 flag as a warning while still deciding', () => {
    const sets = [
      { loadKg: 60, reps: 12, rir: 2 },
      { loadKg: 60, reps: 12, rir: 2 },
      { loadKg: 60, reps: 12, rir: 2 },
    ];
    const current = session('2026-07-01', sets, [painExclusion('2026-07-01', 1)]);
    const result = evaluate(dpContext(), history([]), current, PLAIN_EQUIPMENT);
    expect(result.action).toBe('increase_load');
    expect(result.warnings.some(warning => warning.includes('pain flag'))).toBe(true);
  });
});

describe('double progression: set count below prescription', () => {
  it('repeats after a single short session', () => {
    const current = session('2026-07-08', [
      { loadKg: 60, reps: 10, rir: 2 },
      { loadKg: 60, reps: 10, rir: 2 },
    ]);
    const result = evaluate(dpContext(), history([]), current, PLAIN_EQUIPMENT);
    expect(result.action).toBe('repeat');
    expect(result.reasonCodes).toContain('set_count_below_prescription');
    expect(result.reasonCodes).not.toContain('repeated_failure');
    expect(result.proposedPrescription?.sets).toHaveLength(3);
  });

  it('matches the prescription to reality after two short sessions in a row', () => {
    const short = [
      { loadKg: 60, reps: 10, rir: 2 },
      { loadKg: 60, reps: 10, rir: 2 },
    ];
    const result = evaluate(
      dpContext(),
      history([session('2026-07-01', short)]),
      session('2026-07-08', short),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('reduce_sets');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['set_count_below_prescription', 'repeated_failure'])
    );
    expect(result.proposedPrescription?.sets).toHaveLength(2);
    expect(result.proposedPrescription?.sets[0]?.targetLoadKg).toBe(kilograms(60));
  });
});

describe('double progression: reps below the range floor', () => {
  const failing = [
    { loadKg: 60, reps: 6, rir: 0 },
    { loadKg: 60, reps: 6, rir: 0 },
    { loadKg: 60, reps: 6, rir: 0 },
  ];

  it('repeats after one failing session and says how many are needed', () => {
    const result = evaluate(
      dpContext(),
      history([]),
      session('2026-07-08', failing),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('repeat');
    expect(result.reasonCodes).toContain('reps_below_range');
    expect(result.explanation).toContain('3 are needed');
  });

  it('reduces the load only after three failing sessions in a row', () => {
    const result = evaluate(
      dpContext(),
      history([session('2026-06-24', failing), session('2026-07-01', failing)]),
      session('2026-07-08', failing),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('reduce_load');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['reps_below_range', 'repeated_failure'])
    );
    expect(result.reasonCodes).not.toContain('substantial_performance_drop');
    expect(result.proposedPrescription?.sets[0]?.targetLoadKg).toBe(kilograms(52.5));
  });

  it('reduces after two failing sessions when total reps also collapsed', () => {
    const bigPriorFailure = [
      { loadKg: 60, reps: 7, rir: 0 },
      { loadKg: 60, reps: 7, rir: 0 },
      { loadKg: 60, reps: 7, rir: 0 },
      { loadKg: 60, reps: 7, rir: 0 },
    ];
    const result = evaluate(
      dpContext(),
      history([session('2026-07-01', bigPriorFailure)]),
      session('2026-07-08', failing),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('reduce_load');
    expect(result.reasonCodes).toContain('substantial_performance_drop');
  });

  it('asks for an exercise review when the equipment cannot go lower', () => {
    const bottomedOut = [
      { loadKg: 20, reps: 6, rir: 0 },
      { loadKg: 20, reps: 6, rir: 0 },
      { loadKg: 20, reps: 6, rir: 0 },
    ];
    const equipment = {
      instance: equipmentInstance({
        stackIncrementKg: kilograms(20),
        stackMinimumKg: kilograms(20),
      }),
      definitionDefaultIncrementKg: null,
    };
    const result = evaluate(
      dpContext(),
      history([session('2026-06-24', bottomedOut), session('2026-07-01', bottomedOut)]),
      session('2026-07-08', bottomedOut),
      equipment
    );
    expect(result.action).toBe('review_exercise');
    expect(result.reasonCodes).toContain('cannot_reduce_further');
    expect(result.proposedPrescription).toBeNull();
  });
});

describe('double progression: reps inside the range', () => {
  it('adds reps before load when effort is inside the target band', () => {
    const current = session('2026-07-08', [
      { loadKg: 60, reps: 10, rir: 2 },
      { loadKg: 60, reps: 10, rir: 2 },
      { loadKg: 60, reps: 10, rir: 2 },
    ]);
    const result = evaluate(dpContext(), history([]), current, PLAIN_EQUIPMENT);
    expect(result.action).toBe('increase_reps');
    expect(result.reasonCodes).toContain('reps_within_range');
    expect(result.proposedPrescription?.sets[0]?.targetLoadKg).toBe(kilograms(60));
  });

  it('still asks for reps on missing effort, but says the effort is unknown', () => {
    const current = session('2026-07-08', [
      { loadKg: 60, reps: 10 },
      { loadKg: 60, reps: 10 },
      { loadKg: 60, reps: 10 },
    ]);
    const result = evaluate(dpContext(), history([]), current, PLAIN_EQUIPMENT);
    expect(result.action).toBe('increase_reps');
    expect(result.reasonCodes).toContain('effort_unknown');
    expect(result.confidence).toBe('low');
  });

  it('holds instead of adding reps when the session was harder than prescribed', () => {
    const current = session('2026-07-08', [
      { loadKg: 60, reps: 10, rir: 0 },
      { loadKg: 60, reps: 10, rir: 2 },
      { loadKg: 60, reps: 10, rir: 2 },
    ]);
    const result = evaluate(dpContext(), history([]), current, PLAIN_EQUIPMENT);
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toContain('effort_harder_than_target');
  });
});

describe('double progression: all sets at the top of the range', () => {
  const atTop = [
    { loadKg: 60, reps: 12, rir: 2 },
    { loadKg: 60, reps: 12, rir: 2 },
    { loadKg: 60, reps: 12, rir: 2 },
  ];

  it('treats missing effort as missing evidence, not as an easy session', () => {
    const noEffort = atTop.map(set => ({ loadKg: set.loadKg, reps: set.reps }));
    const result = evaluate(
      dpContext(),
      history([]),
      session('2026-07-08', noEffort),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['all_sets_at_top_of_range', 'effort_unknown'])
    );
    expect(result.confidence).toBe('low');
    expect(result.explanation).toContain('Missing effort is not proof of easy work');
  });

  it('holds when the top of the range was reached too easily', () => {
    const tooEasy = atTop.map(set => ({ ...set, rir: 5 }));
    const result = evaluate(
      dpContext(),
      history([]),
      session('2026-07-08', tooEasy),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toContain('effort_easier_than_target');
  });

  it('holds when readiness is reported low even though the jump is earned', () => {
    const result = evaluate(
      dpContext(),
      history([]),
      session('2026-07-08', atTop),
      PLAIN_EQUIPMENT,
      { readiness: 'low' }
    );
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toContain('readiness_low');
  });

  it('holds and asks for equipment configuration when no increment is known', () => {
    const result = evaluate(
      dpContext(),
      history([]),
      session('2026-07-08', atTop),
      NO_INCREMENT_EQUIPMENT
    );
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toContain('increment_unknown');
    expect(result.warnings.some(warning => warning.includes('Configure'))).toBe(true);
  });

  it('moves the rep range instead of pretending load can change without an increment', () => {
    const wayPast = atTop.map(set => ({ ...set, reps: 14 }));
    const result = evaluate(
      dpContext(),
      history([]),
      session('2026-07-08', wayPast),
      NO_INCREMENT_EQUIPMENT
    );
    expect(result.action).toBe('change_rep_target');
    expect(result.reasonCodes).toContain('reps_above_range');
    expect(result.proposedPrescription?.sets[0]?.targetRepMin).toBe(10);
    expect(result.proposedPrescription?.sets[0]?.targetRepMax).toBe(14);
  });

  it('holds at the equipment maximum instead of proposing an impossible load', () => {
    const equipment = {
      instance: equipmentInstance({
        stackIncrementKg: kilograms(2.5),
        maximumLoadKg: kilograms(60),
      }),
      definitionDefaultIncrementKg: null,
    };
    const result = evaluate(dpContext(), history([]), session('2026-07-08', atTop), equipment);
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toContain('equipment_maximum_reached');
  });

  it('adds the smallest available increment when reps, effort and readiness all agree', () => {
    const priors = [session('2026-06-24', atTop), session('2026-07-01', atTop)];
    const result = evaluate(
      dpContext(),
      history(priors),
      session('2026-07-08', atTop),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('increase_load');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['all_sets_at_top_of_range', 'effort_inside_target_band'])
    );
    expect(result.proposedPrescription?.sets).toHaveLength(3);
    for (const set of result.proposedPrescription?.sets ?? []) {
      expect(set.targetLoadKg).toBe(kilograms(62.5));
      expect(set.targetRepMin).toBe(8);
      expect(set.targetRepMax).toBe(12);
      expect(set.targetRir).toEqual([1, 3]);
    }
    expect(result.confidence).toBe('high');
  });

  it('warns when a single session mixes loads and takes the lowest as achieved', () => {
    const mixed = [
      { loadKg: 62.5, reps: 12, rir: 2 },
      { loadKg: 60, reps: 12, rir: 2 },
      { loadKg: 60, reps: 12, rir: 2 },
    ];
    const result = evaluate(
      dpContext(),
      history([]),
      session('2026-07-08', mixed),
      PLAIN_EQUIPMENT
    );
    expect(result.reasonCodes).toContain('mixed_loads_within_session');
    expect(result.warnings.some(warning => warning.includes('lowest'))).toBe(true);
  });

  it('flags a load that is off the configured increment grid', () => {
    const offGrid = [
      { loadKg: 61, reps: 12, rir: 2 },
      { loadKg: 61, reps: 12, rir: 2 },
      { loadKg: 61, reps: 12, rir: 2 },
    ];
    const result = evaluate(
      dpContext(),
      history([]),
      session('2026-07-08', offGrid),
      PLAIN_EQUIPMENT
    );
    expect(result.reasonCodes).toContain('load_off_equipment_grid');
  });

  it('warns when loads are machine markings rather than measured mass', () => {
    const uncalibrated = atTop.map(set => ({ ...set, calibrated: false }));
    const result = evaluate(
      dpContext(),
      history([]),
      session('2026-07-08', uncalibrated),
      PLAIN_EQUIPMENT
    );
    expect(result.warnings.some(warning => warning.includes('machine markings'))).toBe(true);
  });
});
