import {
  type ExerciseDefinition,
  type SessionExercise,
  type SessionExerciseId,
  type SessionProjection,
  type WorkoutSet,
} from '@ferrum/domain';
import { describeSession, loadExerciseLibrary } from '@ferrum/exercise-library';
import { type RoutineSlotRecord } from '../../db/ferrum-db.ts';

// An imported workout carries no clock — the source records a date, not a start
// and an end — so start and finish land on the same instant. Rendering that as
// "0 s" claims a workout that took no time; the honest answer is that the
// duration is not known, and null lets the caller leave it off entirely.
export function formatDuration(startMillis: number, endMillis: number): string | null {
  const totalSeconds = Math.max(0, Math.round((endMillis - startMillis) / 1000));
  if (totalSeconds === 0) return null;
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

// A session with no title of its own gets one derived from what it trained, so
// a history of hundreds of imported workouts is a list you can actually scan
// instead of the same word repeated. A title the lifter typed always wins.
export function sessionDisplayTitle(projection: SessionProjection): string {
  const session = projection.session;
  if (session?.title != null && session.title.trim() !== '') return session.title;

  const library = loadExerciseLibrary();
  const definitions = projection.exercises
    .map(exercise => library.byId.get(exercise.exerciseDefinitionId))
    .filter((definition): definition is ExerciseDefinition => definition !== undefined);
  return describeSession(definitions);
}
