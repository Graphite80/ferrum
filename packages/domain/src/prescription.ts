import { type Kilograms } from './units.ts';

export type SetType = 'warmup' | 'working' | 'backoff' | 'top' | 'drop' | 'amrap' | 'technique';

export type ProgressionRuleId = string & { readonly __brand: 'ProgressionRuleId' };

export interface DoubleProgressionRule {
  readonly type: 'double_progression';
  readonly sets: number;
  readonly repRange: readonly [number, number];
  readonly targetRir: readonly [number, number];
  readonly incrementPolicy: 'smallest_available' | 'fixed';
  readonly fixedIncrementKg?: Kilograms;
}

export interface LinearLoadRule {
  readonly type: 'linear_load';
  readonly sets: number;
  readonly reps: number;
  readonly targetRir: readonly [number, number];
  readonly incrementPolicy: 'smallest_available' | 'fixed';
  readonly fixedIncrementKg?: Kilograms;
  readonly failuresBeforeBackoff: number;
  readonly backoffFraction: number;
}

export interface TopSetBackoffRule {
  readonly type: 'top_set_backoff';
  readonly topSet: { readonly reps: number; readonly targetRpe: number };
  readonly backoff: {
    readonly sets: number;
    readonly loadFromTopSet: number;
    readonly repDelta: number;
  };
}

export type PrescriptionRule = DoubleProgressionRule | LinearLoadRule | TopSetBackoffRule;

export const PRESCRIPTION_DSL_VERSION = 1;

export interface SetPrescriptionSnapshot {
  readonly prescriptionVersion: number;
  readonly setType: SetType;
  readonly targetLoadKg: Kilograms | null;
  readonly targetRepMin: number | null;
  readonly targetRepMax: number | null;
  readonly targetRir: readonly [number, number] | null;
  readonly targetRpe: number | null;
  readonly ruleId: ProgressionRuleId | null;
  readonly ruleVersion: number | null;
  readonly explanationContext: string | null;
}

export class InvalidPrescription extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPrescription';
  }
}

export function validateRule(rule: PrescriptionRule): void {
  switch (rule.type) {
    case 'double_progression': {
      const [min, max] = rule.repRange;
      if (min > max)
        throw new InvalidPrescription(`repRange ${String(min)}..${String(max)} is inverted`);
      if (min < 1) throw new InvalidPrescription('repRange lower bound must be at least 1');
      if (rule.sets < 1) throw new InvalidPrescription('sets must be at least 1');
      assertRirRange(rule.targetRir);
      if (rule.incrementPolicy === 'fixed' && rule.fixedIncrementKg == null) {
        throw new InvalidPrescription('incrementPolicy "fixed" requires fixedIncrementKg');
      }
      return;
    }
    case 'linear_load': {
      if (rule.sets < 1) throw new InvalidPrescription('sets must be at least 1');
      if (rule.reps < 1) throw new InvalidPrescription('reps must be at least 1');
      if (rule.failuresBeforeBackoff < 1) {
        throw new InvalidPrescription(
          'failuresBeforeBackoff must be at least 1: one bad session is not a deload'
        );
      }
      if (rule.backoffFraction <= 0 || rule.backoffFraction >= 1) {
        throw new InvalidPrescription('backoffFraction must be strictly between 0 and 1');
      }
      assertRirRange(rule.targetRir);
      if (rule.incrementPolicy === 'fixed' && rule.fixedIncrementKg == null) {
        throw new InvalidPrescription('incrementPolicy "fixed" requires fixedIncrementKg');
      }
      return;
    }
    case 'top_set_backoff': {
      if (rule.topSet.reps < 1) throw new InvalidPrescription('topSet.reps must be at least 1');
      if (rule.topSet.targetRpe < 1 || rule.topSet.targetRpe > 10) {
        throw new InvalidPrescription('topSet.targetRpe must be within 1..10');
      }
      if (rule.backoff.sets < 0) throw new InvalidPrescription('backoff.sets must not be negative');
      if (rule.backoff.loadFromTopSet <= 0 || rule.backoff.loadFromTopSet > 1) {
        throw new InvalidPrescription('backoff.loadFromTopSet must be within (0, 1]');
      }
      return;
    }
  }
}

function assertRirRange(range: readonly [number, number]): void {
  const [min, max] = range;
  if (min > max)
    throw new InvalidPrescription(`targetRir ${String(min)}..${String(max)} is inverted`);
  if (min < 0 || max > 10) throw new InvalidPrescription('targetRir must be within 0..10');
}
