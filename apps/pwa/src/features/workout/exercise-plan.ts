import {
  type ComparisonSignature,
  type ExerciseDefinitionId,
  type Kilograms,
  type SessionExercise,
  type SetPrescriptionSnapshot,
  type WorkoutSet,
  comparisonSignature,
  kilograms,
} from '@ferrum/domain';
import { loadExerciseLibrary } from '@ferrum/exercise-library';
import { SEED_ROUTINE, type RoutineSlot } from './routine.ts';

export interface ExercisePlan {
  readonly name: string;
  readonly targetSets: number | null;
  readonly prescription: SetPrescriptionSnapshot | null;
  readonly comparisonSignature: ComparisonSignature;
  readonly incrementKg: Kilograms;
  readonly restSeconds: number;
}

// Everything needed to render and log against an exercise, resolved from the
// session's own recorded sets first so an old session keeps rendering correctly
// after the seed routine changes, then the routine, then the library definition.
export function planExercise(
  exercise: SessionExercise,
  recordedSets: readonly WorkoutSet[]
): ExercisePlan {
  const library = loadExerciseLibrary();
  const definition =
    library.byId.get(exercise.exerciseDefinitionId) ??
    library.resolveAlias(exercise.exerciseDefinitionId);
  const slot =
    SEED_ROUTINE.slots.find(s => s.exerciseDefinitionId === exercise.exerciseDefinitionId) ?? null;
  const lastRecorded = recordedSets.at(-1) ?? null;

  return {
    name: slot?.name ?? definition?.name ?? exercise.exerciseDefinitionId,
    targetSets: slot?.sets ?? null,
    prescription:
      slot != null
        ? prescriptionFromSlot(slot)
        : (recordedSets.findLast(set => set.prescriptionSnapshot != null)?.prescriptionSnapshot ??
          null),
    comparisonSignature:
      lastRecorded?.comparisonSignature ??
      slot?.comparisonSignature ??
      (definition != null
        ? comparisonSignature(definition, null)
        : fallbackSignature(exercise.exerciseDefinitionId)),
    incrementKg: slot?.incrementKg ?? definition?.defaultIncrementKg ?? kilograms(2.5),
    restSeconds: slot?.restSeconds ?? definition?.defaultRestSeconds ?? 120,
  };
}

function prescriptionFromSlot(slot: RoutineSlot): SetPrescriptionSnapshot {
  return {
    prescriptionVersion: 1,
    setType: 'working',
    targetLoadKg: slot.targetLoadKg,
    targetRepMin: slot.targetRepMin,
    targetRepMax: slot.targetRepMax,
    targetRir: slot.targetRir,
    targetRpe: null,
    ruleId: null,
    ruleVersion: null,
    explanationContext: 'seed routine',
  };
}

function fallbackSignature(definitionId: ExerciseDefinitionId): ComparisonSignature {
  return `v1|ex:${definitionId}|eq:-|ls:external|lem:total|rcm:total|lat:bilateral|rom:full|tempo:standard` as ComparisonSignature;
}
