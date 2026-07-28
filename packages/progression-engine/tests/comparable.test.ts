import { describe, expect, it } from 'vitest';
import { comparisonSignature, kilograms, localDate } from '@ferrum/domain';
import { selectComparableHistory, sessionsWithEvidence } from '../src/index.ts';
import {
  definition,
  equipmentInstance,
  workoutSet,
  type WorkoutSetSpec,
} from './support/builders.ts';

const DEF = definition();
const SIG = comparisonSignature(DEF, null);
const DAY = localDate('2026-07-08');
const EARLIER = localDate('2026-07-01');

describe('comparable history selection', () => {
  it('drops sets from a different comparison signature silently, not as exclusions', () => {
    const otherDefinition = definition({ rangeOfMotionVariant: 'partial' });
    const foreign = workoutSet(DAY, 0, {
      loadKg: 60,
      reps: 10,
      signature: comparisonSignature(otherDefinition, null),
    });
    const ours = workoutSet(DAY, 1, { loadKg: 60, reps: 10 });

    const history = selectComparableHistory({
      signature: SIG,
      definition: DEF,
      instance: null,
      sets: [foreign, ours],
    });

    expect(history.sessions).toHaveLength(1);
    expect(history.sessions[0]?.sets).toHaveLength(1);
    expect(history.sessions[0]?.sets[0]?.set.id).toBe(ours.id);
    expect(history.exclusions).toHaveLength(0);
  });

  it('excludes warmup and technique sets from the evidence but keeps them in the trail', () => {
    const history = selectComparableHistory({
      signature: SIG,
      definition: DEF,
      instance: null,
      sets: [
        workoutSet(DAY, 0, { loadKg: 30, reps: 15, setType: 'warmup' }),
        workoutSet(DAY, 1, { loadKg: 60, reps: 10 }),
        workoutSet(DAY, 2, { loadKg: 40, reps: 5, setType: 'technique' }),
      ],
    });

    expect(history.sessions[0]?.sets).toHaveLength(1);
    expect(history.exclusions.map(item => item.reason)).toEqual([
      'warmup_or_technique',
      'warmup_or_technique',
    ]);
  });

  it('excludes pain-flagged sets so pain never becomes progression evidence', () => {
    const history = selectComparableHistory({
      signature: SIG,
      definition: DEF,
      instance: null,
      sets: [
        workoutSet(DAY, 0, { loadKg: 60, reps: 10, painFlag: 1 }),
        workoutSet(DAY, 1, { loadKg: 60, reps: 10 }),
      ],
    });

    expect(history.sessions[0]?.sets).toHaveLength(1);
    expect(history.exclusions[0]?.reason).toBe('pain_flagged');
    expect(history.exclusions[0]?.detail).toBe('pain flag 1');
  });

  it('excludes indeterminate loads and surfaces the reason instead of inventing a number', () => {
    const perSide = definition({ loadEntryMode: 'per_side' });
    const signature = comparisonSignature(perSide, null);
    const history = selectComparableHistory({
      signature,
      definition: perSide,
      instance: null,
      sets: [workoutSet(DAY, 0, { loadKg: 40, reps: 10, signature })],
    });

    expect(history.sessions[0]?.sets).toHaveLength(0);
    expect(history.exclusions[0]?.reason).toBe('indeterminate_load');
    expect(history.exclusions[0]?.detail).toBe('bar_mass_unknown');
    expect(history.indeterminateReasons).toEqual(['bar_mass_unknown']);
  });

  it('excludes planned and skipped sets: only completed work is evidence', () => {
    const history = selectComparableHistory({
      signature: SIG,
      definition: DEF,
      instance: null,
      sets: [
        workoutSet(DAY, 0, { loadKg: 60, reps: 10, status: 'planned' }),
        workoutSet(DAY, 1, { loadKg: 60, reps: 10, status: 'skipped' }),
      ],
    });

    expect(sessionsWithEvidence(history)).toHaveLength(0);
    expect(history.exclusions.map(item => item.reason)).toEqual(['not_completed', 'not_completed']);
  });

  it('excludes sets without reps, without load, and with a zero resolved load', () => {
    const history = selectComparableHistory({
      signature: SIG,
      definition: DEF,
      instance: null,
      sets: [
        workoutSet(DAY, 0, { loadKg: 60 }),
        workoutSet(DAY, 1, { reps: 10 }),
        workoutSet(DAY, 2, { loadKg: 0, reps: 10 }),
      ],
    });

    expect(history.sessions[0]?.sets).toHaveLength(0);
    expect(history.exclusions.map(item => item.reason)).toEqual([
      'no_reps_recorded',
      'no_load_recorded',
      'zero_resolved_load',
    ]);
  });

  it('excludes non-load-bearing work from load progression evidence', () => {
    const repsOnly = definition({ loadSemantics: 'repetitions_only', equipmentType: 'bodyweight' });
    const signature = comparisonSignature(repsOnly, null);
    const history = selectComparableHistory({
      signature,
      definition: repsOnly,
      instance: null,
      sets: [workoutSet(DAY, 0, { reps: 20, signature })],
    });

    expect(history.exclusions[0]?.reason).toBe('not_load_bearing');
  });

  it('applies the bodyweight evidence rules to bodyweight exercises', () => {
    const pushup = definition({
      loadSemantics: 'bodyweight',
      equipmentType: 'bodyweight',
      bodyweightFraction: 0.64,
    });
    const signature = comparisonSignature(pushup, null);
    const set = (index: number, bodyweight: WorkoutSetSpec['bodyweight']) =>
      workoutSet(DAY, index, { reps: 12, signature, bodyweight });

    const history = selectComparableHistory({
      signature,
      definition: pushup,
      instance: null,
      sets: [
        set(0, { kg: 80, source: 'default_profile', ageDays: 0 }),
        set(1, { kg: 80, source: 'last_known', ageDays: 40 }),
        set(2, { kg: 80, source: 'last_known', ageDays: 10 }),
        set(3, { kg: 80, source: 'measured_today', ageDays: 0 }),
      ],
    });

    expect(history.exclusions.map(item => item.reason)).toEqual([
      'bodyweight_not_evidence',
      'bodyweight_not_evidence',
    ]);
    expect(history.sessions[0]?.sets).toHaveLength(2);
    expect(history.sessions[0]?.sets[0]?.systemLoadKg).toBe(kilograms(51.2));
  });

  it('doubles per-hand loads and per-side reps into system terms', () => {
    const dumbbell = definition({
      loadEntryMode: 'per_hand',
      equipmentType: 'dumbbell',
      repCountMode: 'per_side',
      laterality: 'unilateral_isolated',
    });
    const signature = comparisonSignature(dumbbell, null);
    const history = selectComparableHistory({
      signature,
      definition: dumbbell,
      instance: null,
      sets: [workoutSet(DAY, 0, { loadKg: 20, reps: 10, signature })],
    });

    const comparable = history.sessions[0]?.sets[0];
    expect(comparable?.systemLoadKg).toBe(kilograms(40));
    expect(comparable?.reps).toBe(20);
  });

  it('marks stack markings uncalibrated until a pulley ratio is configured', () => {
    const stack = definition({ loadSemantics: 'machine_stack', equipmentType: 'machine_stack' });

    const bare = selectComparableHistory({
      signature: comparisonSignature(stack, null),
      definition: stack,
      instance: null,
      sets: [
        workoutSet(DAY, 0, { loadKg: 50, reps: 10, signature: comparisonSignature(stack, null) }),
      ],
    });
    expect(bare.sessions[0]?.sets[0]?.calibrated).toBe(false);
    expect(bare.sessions[0]?.sets[0]?.systemLoadKg).toBe(kilograms(50));

    const calibratedInstance = equipmentInstance({ pulleyRatio: 2 });
    const calibratedSignature = comparisonSignature(stack, calibratedInstance);
    const calibrated = selectComparableHistory({
      signature: calibratedSignature,
      definition: stack,
      instance: calibratedInstance,
      sets: [workoutSet(DAY, 0, { loadKg: 50, reps: 10, signature: calibratedSignature })],
    });
    expect(calibrated.sessions[0]?.sets[0]?.calibrated).toBe(true);
    expect(calibrated.sessions[0]?.sets[0]?.systemLoadKg).toBe(kilograms(100));
  });

  it('reads effort from RIR first, then from the RIR-anchored RPE mapping', () => {
    const history = selectComparableHistory({
      signature: SIG,
      definition: DEF,
      instance: null,
      sets: [
        workoutSet(DAY, 0, { loadKg: 60, reps: 10, rir: 1, rpe: 7 }),
        workoutSet(DAY, 1, { loadKg: 60, reps: 10, rpe: 7.5 }),
        workoutSet(DAY, 2, { loadKg: 60, reps: 10 }),
      ],
    });

    const efforts = history.sessions[0]?.sets.map(item => item.effort);
    expect(efforts?.[0]).toEqual({ kind: 'rir_entered', rir: 1 });
    expect(efforts?.[1]).toEqual({ kind: 'rpe_entered', rir: 2.5, rpe: 7.5 });
    expect(efforts?.[2]).toEqual({ kind: 'unknown' });
  });

  it('orders sessions by date and sets by order index, and filters evidence-free sessions', () => {
    const history = selectComparableHistory({
      signature: SIG,
      definition: DEF,
      instance: null,
      sets: [
        workoutSet(DAY, 1, { loadKg: 62.5, reps: 9 }),
        workoutSet(DAY, 0, { loadKg: 60, reps: 10 }),
        workoutSet(EARLIER, 0, { loadKg: 57.5, reps: 12 }),
        workoutSet(localDate('2026-06-24'), 0, { loadKg: 55, reps: 10, setType: 'warmup' }),
      ],
    });

    expect(history.sessions.map(item => item.localDate)).toEqual(['2026-06-24', EARLIER, DAY]);
    expect(history.sessions[2]?.sets.map(item => item.set.orderIndex)).toEqual([0, 1]);
    expect(sessionsWithEvidence(history).map(item => item.localDate)).toEqual([EARLIER, DAY]);
  });
});
