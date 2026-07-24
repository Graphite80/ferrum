import {
  type ComparisonSignature,
  type ExerciseDefinitionId,
  type Kilograms,
  kilograms,
} from '@ferrum/domain';

export interface RoutineSlot {
  readonly exerciseDefinitionId: ExerciseDefinitionId;
  readonly name: string;
  readonly comparisonSignature: ComparisonSignature;
  readonly sets: number;
  readonly targetLoadKg: Kilograms;
  readonly targetRepMin: number;
  readonly targetRepMax: number;
  readonly targetRir: readonly [number, number];
  readonly incrementKg: Kilograms;
  readonly restSeconds: number;
}

export interface Routine {
  readonly id: string;
  readonly name: string;
  readonly slots: readonly RoutineSlot[];
}

function slot(
  id: string,
  name: string,
  targetLoadKg: number,
  restSeconds: number,
  incrementKg: number
): RoutineSlot {
  return {
    exerciseDefinitionId: id as ExerciseDefinitionId,
    name,
    comparisonSignature:
      `v1|ex:${id}|eq:-|ls:machine_stack|lem:total|rcm:total|lat:bilateral|rom:full|tempo:standard` as ComparisonSignature,
    sets: 3,
    targetLoadKg: kilograms(targetLoadKg),
    targetRepMin: 8,
    targetRepMax: 12,
    targetRir: [1, 3],
    incrementKg: kilograms(incrementKg),
    restSeconds,
  };
}

// Seeded from the loads actually present in the real training history so the
// vertical slice is exercised with plausible numbers rather than invented ones.
// Replaced by the routine builder in phase 2; this is not a user-facing feature.
export const SEED_ROUTINE: Routine = {
  id: 'seed-full-body',
  name: 'Full body A',
  slots: [
    slot('squat-machine', 'Squat (Machine)', 80, 180, 5),
    slot('lat-pulldown-cable', 'Lat Pulldown (Cable)', 65, 150, 5),
    slot('shoulder-press-machine-plates', 'Shoulder Press (Machine Plates)', 45, 150, 5),
    slot('triceps-pushdown', 'Triceps Pushdown', 30, 90, 2.5),
  ],
};
