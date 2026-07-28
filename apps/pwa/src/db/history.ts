import { type ExerciseDefinitionId, type SessionId, isWorkingSet } from '@ferrum/domain';
import { listSessionIds, loadSession } from './event-store.ts';

export interface LastPerformance {
  readonly loadKg: number | null;
  readonly reps: number | null;
}

// Sessions are ~40 events each, so replaying them newest-first until every
// exercise is resolved is cheaper than maintaining a second index that could
// drift from the log.
export async function lastPerformances(
  definitionIds: readonly ExerciseDefinitionId[],
  excludeSessionId: SessionId
): Promise<Map<ExerciseDefinitionId, LastPerformance | null>> {
  const found = new Map<ExerciseDefinitionId, LastPerformance | null>();
  const unresolved = new Set(definitionIds);
  if (unresolved.size === 0) return found;

  for (const sessionId of await listSessionIds()) {
    if (unresolved.size === 0) break;
    if (sessionId === excludeSessionId) continue;
    const projection = await loadSession(sessionId);
    if (projection.session?.status !== 'finished') continue;

    for (const definitionId of [...unresolved]) {
      const exerciseIds = new Set(
        projection.exercises
          .filter(exercise => exercise.exerciseDefinitionId === definitionId)
          .map(exercise => exercise.id)
      );
      if (exerciseIds.size === 0) continue;
      const sets = projection.sets.filter(set => exerciseIds.has(set.sessionExerciseId));
      const source = sets.filter(isWorkingSet).at(-1) ?? sets.at(-1);
      if (source == null) continue;
      found.set(definitionId, {
        loadKg: source.measurements.enteredLoad,
        reps: source.measurements.reps,
      });
      unresolved.delete(definitionId);
    }
  }

  for (const definitionId of unresolved) found.set(definitionId, null);
  return found;
}
