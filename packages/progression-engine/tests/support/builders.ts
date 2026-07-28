import {
  instant,
  kilograms,
  localDate,
  type ComparisonSignature,
  type DeviceId,
  type DoubleProgressionRule,
  type EquipmentInstance,
  type EquipmentInstanceId,
  type ExerciseDefinition,
  type ExerciseDefinitionId,
  type GymProfileId,
  type LinearLoadRule,
  type LocalDate,
  type MovementId,
  type MuscleId,
  type PainFlag,
  type ProgressionRuleId,
  type SessionExerciseId,
  type SetStatus,
  type SetType,
  type TopSetBackoffRule,
  type WorkoutSet,
  type WorkoutSetId,
  type BodyweightSource,
} from '@ferrum/domain';
import {
  type ComparableHistory,
  type ComparableSession,
  type ComparableSet,
  type EffortEvidence,
  type EquipmentConstraints,
  type ExcludedSet,
  type PrescriptionContext,
} from '../../src/index.ts';

export const SIGNATURE =
  'v1|ex:test_press|eq:-|ls:external|lem:total|rcm:total|lat:bilateral|rom:full|tempo:standard' as ComparisonSignature;

export interface SetSpec {
  readonly loadKg: number;
  readonly reps: number;
  readonly rir?: number | undefined;
  readonly rpe?: number | undefined;
  readonly restSeconds?: number | undefined;
  readonly calibrated?: boolean | undefined;
}

export interface WorkoutSetSpec {
  readonly loadKg?: number | null | undefined;
  readonly reps?: number | null | undefined;
  readonly rir?: number | null | undefined;
  readonly rpe?: number | null | undefined;
  readonly restSeconds?: number | null | undefined;
  readonly painFlag?: PainFlag | undefined;
  readonly setType?: SetType | undefined;
  readonly status?: SetStatus | undefined;
  readonly signature?: ComparisonSignature | undefined;
  readonly bodyweight?:
    | { readonly kg: number; readonly source: BodyweightSource; readonly ageDays: number | null }
    | undefined;
}

export function workoutSet(date: LocalDate, index: number, spec: WorkoutSetSpec = {}): WorkoutSet {
  return {
    id: `set-${date}-${String(index)}` as WorkoutSetId,
    sessionExerciseId: `sxe-${date}` as SessionExerciseId,
    orderIndex: index,
    setType: spec.setType ?? 'working',
    status: spec.status ?? 'completed',
    measurements: {
      enteredLoad: spec.loadKg ?? null,
      enteredUnit: 'kg',
      canonicalExternalLoadKg: spec.loadKg == null ? null : kilograms(spec.loadKg),
      reps: spec.reps ?? null,
      durationSeconds: null,
      distanceMeters: null,
      rirEntered: spec.rir ?? null,
      rpeEntered: spec.rpe ?? null,
      actualRestSeconds: spec.restSeconds ?? null,
    },
    qualifiers: {
      tempo: null,
      rangeOfMotionNote: null,
      painFlag: spec.painFlag ?? 0,
      formFlag: false,
      note: null,
    },
    equipmentInstanceId: null,
    bodyweightKgSnapshot: spec.bodyweight == null ? null : kilograms(spec.bodyweight.kg),
    bodyweightSource: spec.bodyweight?.source ?? null,
    bodyweightAgeDays: spec.bodyweight?.ageDays ?? null,
    prescriptionSnapshot: null,
    exerciseRevisionSnapshot: 1,
    comparisonSignature: spec.signature ?? SIGNATURE,
    provenance: null,
    performedAt: null,
    recordedAt: instant(1_000_000 + index),
    localDate: date,
    tzOffsetMinutes: 0,
    sourceDeviceId: 'test-device' as DeviceId,
  };
}

export function effortOf(spec: SetSpec): EffortEvidence {
  if (spec.rir != null) return { kind: 'rir_entered', rir: spec.rir };
  if (spec.rpe != null) return { kind: 'rpe_entered', rir: 10 - spec.rpe, rpe: spec.rpe };
  return { kind: 'unknown' };
}

export function comparableSet(date: LocalDate, index: number, spec: SetSpec): ComparableSet {
  return {
    set: workoutSet(date, index, spec),
    localDate: date,
    systemLoadKg: kilograms(spec.loadKg),
    calibrated: spec.calibrated ?? true,
    reps: spec.reps,
    effort: effortOf(spec),
    restSeconds: spec.restSeconds ?? null,
  };
}

export function session(
  date: string,
  specs: readonly SetSpec[],
  exclusions: readonly ExcludedSet[] = []
): ComparableSession {
  const day = localDate(date);
  return {
    localDate: day,
    sets: specs.map((spec, index) => comparableSet(day, index, spec)),
    exclusions,
  };
}

export function painExclusion(date: string, painFlag: PainFlag): ExcludedSet {
  const day = localDate(date);
  return {
    set: workoutSet(day, 99, { loadKg: 60, reps: 8, painFlag }),
    reason: 'pain_flagged',
    detail: `pain flag ${String(painFlag)}`,
  };
}

export function warmupExclusion(date: string): ExcludedSet {
  const day = localDate(date);
  return {
    set: workoutSet(day, 98, { loadKg: 20, reps: 15, setType: 'warmup' }),
    reason: 'warmup_or_technique',
    detail: 'set type warmup',
  };
}

export function history(sessions: readonly ComparableSession[]): ComparableHistory {
  return {
    signature: SIGNATURE,
    sessions,
    exclusions: sessions.flatMap(item => [...item.exclusions]),
    indeterminateReasons: [],
  };
}

export const DP_RULE: DoubleProgressionRule = {
  type: 'double_progression',
  sets: 3,
  repRange: [8, 12],
  targetRir: [1, 3],
  incrementPolicy: 'smallest_available',
};

export const LL_RULE: LinearLoadRule = {
  type: 'linear_load',
  sets: 3,
  reps: 5,
  targetRir: [1, 3],
  incrementPolicy: 'smallest_available',
  failuresBeforeBackoff: 2,
  backoffFraction: 0.9,
};

export const TSB_RULE: TopSetBackoffRule = {
  type: 'top_set_backoff',
  topSet: { reps: 5, targetRpe: 8 },
  backoff: { sets: 3, loadFromTopSet: 0.8, repDelta: 2 },
};

export function dpContext(
  overrides: Partial<DoubleProgressionRule> = {},
  targetLoadKg: number | null = null
): PrescriptionContext<DoubleProgressionRule> {
  return {
    ruleId: 'rule-dp' as ProgressionRuleId,
    ruleVersion: 1,
    rule: { ...DP_RULE, ...overrides },
    signature: SIGNATURE,
    currentTargetLoadKg: targetLoadKg == null ? null : kilograms(targetLoadKg),
    prescribedRestSeconds: 180,
  };
}

export function llContext(
  overrides: Partial<LinearLoadRule> = {},
  targetLoadKg: number | null = null
): PrescriptionContext<LinearLoadRule> {
  return {
    ruleId: 'rule-ll' as ProgressionRuleId,
    ruleVersion: 1,
    rule: { ...LL_RULE, ...overrides },
    signature: SIGNATURE,
    currentTargetLoadKg: targetLoadKg == null ? null : kilograms(targetLoadKg),
    prescribedRestSeconds: 180,
  };
}

export function tsbContext(
  overrides: Partial<TopSetBackoffRule> = {},
  targetLoadKg: number | null = null
): PrescriptionContext<TopSetBackoffRule> {
  return {
    ruleId: 'rule-tsb' as ProgressionRuleId,
    ruleVersion: 1,
    rule: { ...TSB_RULE, ...overrides },
    signature: SIGNATURE,
    currentTargetLoadKg: targetLoadKg == null ? null : kilograms(targetLoadKg),
    prescribedRestSeconds: 180,
  };
}

export const PLAIN_EQUIPMENT: EquipmentConstraints = {
  instance: null,
  definitionDefaultIncrementKg: kilograms(2.5),
};

export const NO_INCREMENT_EQUIPMENT: EquipmentConstraints = {
  instance: null,
  definitionDefaultIncrementKg: null,
};

export function equipmentInstance(overrides: Partial<EquipmentInstance> = {}): EquipmentInstance {
  return {
    id: 'eq-01' as EquipmentInstanceId,
    profileId: 'gym-01' as GymProfileId,
    exerciseDefinitionId: null,
    name: 'test machine',
    manufacturer: null,
    barMassKg: null,
    stackIncrementKg: null,
    stackMinimumKg: null,
    pulleyRatio: null,
    dumbbellIncrementKg: null,
    availablePlatePairsKg: [],
    maximumLoadKg: null,
    equivalenceGroupId: null,
    notes: null,
    ...overrides,
  };
}

export function definition(overrides: Partial<ExerciseDefinition> = {}): ExerciseDefinition {
  return {
    id: 'test_press' as ExerciseDefinitionId,
    movementId: 'horizontal_press' as MovementId,
    name: 'Test Press',
    aliases: [],
    equipmentType: 'barbell',
    laterality: 'bilateral',
    loadSemantics: 'external',
    loadEntryMode: 'total',
    repCountMode: 'total',
    rangeOfMotionVariant: 'full',
    tempoVariant: 'standard',
    bodyweightFraction: 0,
    muscleRoles: [{ muscleId: 'pectoralis_major' as MuscleId, role: 'primary' }],
    defaultRestSeconds: 180,
    defaultIncrementKg: kilograms(2.5),
    userCreated: false,
    revision: 1,
    ...overrides,
  };
}
