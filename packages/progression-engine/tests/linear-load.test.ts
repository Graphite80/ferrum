import { describe, expect, it } from 'vitest';
import { kilograms } from '@ferrum/domain';
import { linearLoadPolicy, policyFor } from '../src/index.ts';
import {
  LL_RULE,
  NO_INCREMENT_EQUIPMENT,
  PLAIN_EQUIPMENT,
  equipmentInstance,
  history,
  llContext,
  painExclusion,
  session,
} from './support/builders.ts';

const evaluate = linearLoadPolicy.evaluate.bind(linearLoadPolicy);

const completed = [
  { loadKg: 100, reps: 5, rir: 2 },
  { loadKg: 100, reps: 5, rir: 2 },
  { loadKg: 100, reps: 5, rir: 2 },
];

const missed = [
  { loadKg: 100, reps: 4, rir: 0 },
  { loadKg: 100, reps: 4, rir: 0 },
  { loadKg: 100, reps: 4, rir: 0 },
];

describe('policy registry', () => {
  it('routes linear_load rules to the linear load policy', () => {
    expect(policyFor(LL_RULE)).toBe(linearLoadPolicy);
  });
});

describe('linear load: insufficient data', () => {
  it('refuses to guess when no session was performed', () => {
    const result = evaluate(llContext(), history([]), null, PLAIN_EQUIPMENT);
    expect(result.action).toBe('insufficient_data');
    expect(result.proposedPrescription).toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('refuses to guess when every set of the session was excluded', () => {
    const current = session('2026-07-08', [], [painExclusion('2026-07-08', 1)]);
    const result = evaluate(llContext(), history([]), current, PLAIN_EQUIPMENT);
    expect(result.action).toBe('insufficient_data');
    expect(result.reasonCodes).toContain('no_comparable_sets');
  });
});

describe('linear load: pain', () => {
  it('sends pain level 2 to exercise review', () => {
    const current = session('2026-07-08', completed, [painExclusion('2026-07-08', 3)]);
    const result = evaluate(llContext(), history([]), current, PLAIN_EQUIPMENT);
    expect(result.action).toBe('review_exercise');
    expect(result.reasonCodes).toContain('pain_reported');
    expect(result.confidence).toBe('high');
  });

  it('surfaces a pain level 1 flag as a warning while still deciding', () => {
    const current = session('2026-07-08', completed, [painExclusion('2026-07-08', 1)]);
    const result = evaluate(llContext(), history([]), current, PLAIN_EQUIPMENT);
    expect(result.action).toBe('increase_load');
    expect(result.warnings.some(warning => warning.includes('pain flag'))).toBe(true);
  });
});

describe('linear load: missed prescription', () => {
  it('repeats after a single miss and reports that rest went unrecorded', () => {
    const result = evaluate(
      llContext(),
      history([]),
      session('2026-07-08', missed),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('repeat');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['reps_below_range', 'rest_not_recorded'])
    );
    expect(result.proposedPrescription?.sets[0]?.targetLoadKg).toBe(kilograms(100));
  });

  it('repeats without blaming rest when the recorded rest was adequate', () => {
    const rested = missed.map(set => ({ ...set, restSeconds: 170 }));
    const result = evaluate(
      llContext(),
      history([]),
      session('2026-07-08', rested),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('repeat');
    expect(result.reasonCodes).not.toContain('rest_not_recorded');
    expect(result.reasonCodes).not.toContain('rest_shorter_than_prescribed');
  });

  it('blames measured short rest before touching the load', () => {
    const rushed = missed.map(set => ({ ...set, restSeconds: 60 }));
    const result = evaluate(
      llContext(),
      history([]),
      session('2026-07-08', rushed),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('increase_rest');
    expect(result.reasonCodes).toContain('rest_shorter_than_prescribed');
    expect(result.proposedPrescription?.sets[0]?.targetLoadKg).toBe(kilograms(100));
  });

  it('overrides a failuresBeforeBackoff of 1: one bad session is never a deload', () => {
    const result = evaluate(
      llContext({ failuresBeforeBackoff: 1 }),
      history([]),
      session('2026-07-08', missed),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('repeat');
    expect(result.explanation).toContain('1 of the 2 failing sessions');
  });

  it('backs off by the rule fraction after the required failures', () => {
    const result = evaluate(
      llContext(),
      history([session('2026-07-01', missed)]),
      session('2026-07-08', missed),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('reduce_load');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['reps_below_range', 'repeated_failure'])
    );
    expect(result.proposedPrescription?.sets[0]?.targetLoadKg).toBe(kilograms(90));
  });

  it('asks for an exercise review when the equipment cannot go lower', () => {
    const bottomedOut = missed.map(set => ({ ...set, loadKg: 20 }));
    const equipment = {
      instance: equipmentInstance({
        stackIncrementKg: kilograms(20),
        stackMinimumKg: kilograms(20),
      }),
      definitionDefaultIncrementKg: null,
    };
    const result = evaluate(
      llContext(),
      history([session('2026-07-01', bottomedOut)]),
      session('2026-07-08', bottomedOut),
      equipment
    );
    expect(result.action).toBe('review_exercise');
    expect(result.reasonCodes).toContain('cannot_reduce_further');
    expect(result.proposedPrescription).toBeNull();
  });
});

describe('linear load: prescription completed', () => {
  it('treats missing effort as missing evidence and holds the load', () => {
    const noEffort = completed.map(set => ({ loadKg: set.loadKg, reps: set.reps }));
    const result = evaluate(
      llContext(),
      history([]),
      session('2026-07-08', noEffort),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toContain('effort_unknown');
    expect(result.confidence).toBe('low');
  });

  it('holds when the work was completed too easily', () => {
    const tooEasy = completed.map(set => ({ ...set, rir: 5 }));
    const result = evaluate(
      llContext(),
      history([]),
      session('2026-07-08', tooEasy),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toContain('effort_easier_than_target');
  });

  it('holds when the work was harder than the target band', () => {
    const tooHard = completed.map(set => ({ ...set, rir: 0 }));
    const result = evaluate(
      llContext(),
      history([]),
      session('2026-07-08', tooHard),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toContain('effort_harder_than_target');
  });

  it('holds and asks for equipment configuration when no increment is known', () => {
    const result = evaluate(
      llContext(),
      history([]),
      session('2026-07-08', completed),
      NO_INCREMENT_EQUIPMENT
    );
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toContain('increment_unknown');
  });

  it('holds when readiness is reported low', () => {
    const result = evaluate(
      llContext(),
      history([]),
      session('2026-07-08', completed),
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
    const result = evaluate(llContext(), history([]), session('2026-07-08', completed), equipment);
    expect(result.action).toBe('hold');
    expect(result.reasonCodes).toContain('equipment_maximum_reached');
  });

  it('adds the smallest available increment when the prescription was earned', () => {
    const priors = [session('2026-06-24', completed), session('2026-07-01', completed)];
    const result = evaluate(
      llContext(),
      history(priors),
      session('2026-07-08', completed),
      PLAIN_EQUIPMENT
    );
    expect(result.action).toBe('increase_load');
    expect(result.reasonCodes).toContain('effort_inside_target_band');
    expect(result.proposedPrescription?.sets).toHaveLength(3);
    for (const set of result.proposedPrescription?.sets ?? []) {
      expect(set.targetLoadKg).toBe(kilograms(102.5));
      expect(set.targetRepMin).toBe(5);
      expect(set.targetRepMax).toBe(5);
    }
    expect(result.confidence).toBe('high');
  });
});
