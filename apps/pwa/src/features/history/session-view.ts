import {
  type SessionExercise,
  type SessionExerciseId,
  type SessionProjection,
  type WorkoutSet,
} from '@ferrum/domain';
import { loadExerciseLibrary } from '@ferrum/exercise-library';
import { type RoutineSlotRecord } from '../../db/ferrum-db.ts';

export function formatDuration(startMillis: number, endMillis: number): string {
  const totalSeconds = Math.max(0, Math.round((endMillis - startMillis) / 1000));
  if (totalSeconds < 60) return `${String(totalSeconds)} s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${String(totalMinutes)} min`;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours)} h ${String(totalMinutes % 60)} min`;
}

export function exerciseDisplayName(
  exercise: SessionExercise,
  planSlots: readonly RoutineSlotRecord[]
): string {
  const slot = planSlots.find(s => s.exerciseDefinitionId === exercise.exerciseDefinitionId);
  if (slot != null) return slot.name;
  const library = loadExerciseLibrary();
  return (
    library.byId.get(exercise.exerciseDefinitionId)?.name ??
    library.resolveAlias(exercise.exerciseDefinitionId)?.name ??
    exercise.exerciseDefinitionId
  );
}

export function setsForExercise(
  projection: SessionProjection,
  sessionExerciseId: SessionExerciseId
): { live: WorkoutSet[]; deleted: WorkoutSet[] } {
  return {
    live: projection.sets.filter(set => set.sessionExerciseId === sessionExerciseId),
    deleted: projection.deletedSets.filter(set => set.sessionExerciseId === sessionExerciseId),
  };
}
