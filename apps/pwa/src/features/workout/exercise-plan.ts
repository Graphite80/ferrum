import {
  type ComparisonSignature,
  type ExerciseDefinition,
  type EquipmentInstance,
  type ExerciseDefinitionId,
  type Kilograms,
  type SessionExercise,
  type SetPrescriptionSnapshot,
  type WorkoutSet,
  comparisonSignature,
  equipmentIdentityMatters,
  kilograms,
  smallestAvailableIncrement,
} from '@ferrum/domain';
import { loadExerciseLibrary } from '@ferrum/exercise-library';
import { type RoutineSlotRecord } from '../../db/ferrum-db.ts';

export interface ExercisePlan {
  readonly name: string;
  readonly targetSets: number | null;
  readonly prescription: SetPrescriptionSnapshot | null;
  readonly comparisonSignature: ComparisonSignature;
  readonly incrementKg: Kilograms;
  readonly restSeconds: number;
  // True when the number the user types only means something on one machine, so the
  // UI has to ask which one it is.
  readonly needsEquipment: boolean;
}

// A session records whatever exercise id it was created with, and the seeded routine
// uses hyphenated ids that predate the library's canonical ones. Everything that keys
// off an exercise — the plan, the machine, the diagram — has to agree on which
// definition that is, so the resolution lives in one place.
export function resolveDefinition(
  exerciseDefinitionId: ExerciseDefinitionId
): ExerciseDefinition | null {
  const library = loadExerciseLibrary();
  return (
    library.byId.get(exerciseDefinitionId) ?? library.resolveAlias(exerciseDefinitionId) ?? null
  );
}

// The library's id for whatever the caller wrote. Anything it cannot name is
// returned untouched — a user-created exercise is still one exercise, and two
// sessions naming it identically must keep comparing equal.
export function canonicalDefinitionId(
  exerciseDefinitionId: ExerciseDefinitionId
): ExerciseDefinitionId {
  return resolveDefinition(exerciseDefinitionId)?.id ?? exerciseDefinitionId;
}

// Everything needed to render and log against an exercise, resolved from the
// session's own recorded sets first so an old session keeps rendering correctly
// after the routine changes, then the session's plan snapshot, then the library.
export function planExercise(
  exercise: SessionExercise,
  recordedSets: readonly WorkoutSet[],
  planSlots: readonly RoutineSlotRecord[],
  instance: EquipmentInstance | null = null
): ExercisePlan {
  const definition = resolveDefinition(exercise.exerciseDefinitionId);
  const slot =
    planSlots.find(s => s.exerciseDefinitionId === exercise.exerciseDefinitionId) ?? null;
  const lastRecorded = recordedSets.at(-1) ?? null;

  return {
    name: slot?.name ?? definition?.name ?? exercise.exerciseDefinitionId,
    targetSets: slot?.sets ?? null,
    prescription:
      slot != null
        ? prescriptionFromSlot(slot)
        : (recordedSets.findLast(set => set.prescriptionSnapshot != null)?.prescriptionSnapshot ??
          null),
    // A set already logged pins the bucket: one exercise in one session happened on
    // one machine. Naming a machine is otherwise an explicit act of re-bucketing and
    // outranks the routine's stored signature; without one, nothing changes.
    comparisonSignature:
      lastRecorded?.comparisonSignature ??
      (instance != null && definition != null
        ? comparisonSignature(definition, instance)
        : ((slot?.comparisonSignature as ComparisonSignature | undefined) ??
          (definition != null
            ? comparisonSignature(definition, null)
            : fallbackSignature(exercise.exerciseDefinitionId)))),
    incrementKg:
      smallestAvailableIncrement(instance, null)?.kilograms ??
      (slot != null
        ? kilograms(slot.incrementKg)
        : (definition?.defaultIncrementKg ?? kilograms(2.5))),
    restSeconds: slot?.restSeconds ?? definition?.defaultRestSeconds ?? 120,
    needsEquipment: definition != null && equipmentIdentityMatters(definition.equipmentType),
  };
}

function prescriptionFromSlot(slot: RoutineSlotRecord): SetPrescriptionSnapshot {
  return {
    prescriptionVersion: 1,
    setType: 'working',
    targetLoadKg: slot.targetLoadKg == null ? null : kilograms(slot.targetLoadKg),
    targetRepMin: slot.targetRepMin,
    targetRepMax: slot.targetRepMax,
    targetRir: [slot.targetRirMin, slot.targetRirMax],
    targetRpe: null,
    ruleId: null,
    ruleVersion: null,
    explanationContext: 'routine',
  };
}

function fallbackSignature(definitionId: ExerciseDefinitionId): ComparisonSignature {
  return `v1|ex:${definitionId}|eq:-|ls:external|lem:total|rcm:total|lat:bilateral|rom:full|tempo:standard` as ComparisonSignature;
}
