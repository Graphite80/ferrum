import {
  type ComparisonSignature,
  type ExerciseDefinitionId,
  type SessionId,
  type WorkoutSet,
  isWorkingSet,
} from '@ferrum/domain';
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
        loadKg: source.measurements.canonicalExternalLoadKg,
        reps: source.measurements.reps,
      });
      unresolved.delete(definitionId);
    }
  }

  for (const definitionId of unresolved) found.set(definitionId, null);
  return found;
}

export interface TopSet {
  readonly loadKg: number;
  readonly reps: number;
}

export function topWorkingSet(sets: readonly WorkoutSet[]): TopSet | null {
  let best: TopSet | null = null;
  for (const set of sets) {
    if (!isWorkingSet(set)) continue;
    const loadKg = set.measurements.canonicalExternalLoadKg;
    if (loadKg == null) continue;
    const reps = set.measurements.reps ?? 0;
    if (best == null || loadKg > best.loadKg || (loadKg === best.loadKg && reps > best.reps)) {
      best = { loadKg, reps };
    }
  }
  return best;
}

// PRs only exist between comparable sets (INVARIANTS §1), so the prior best is
// keyed by the full comparison signature, never by exercise name.
export async function bestPriorSets(
  signatures: readonly ComparisonSignature[],
  excludeSessionId: SessionId
): Promise<Map<ComparisonSignature, TopSet | null>> {
  const best = new Map<ComparisonSignature, TopSet | null>();
  for (const signature of signatures) best.set(signature, null);
  if (best.size === 0) return best;

  for (const sessionId of await listSessionIds()) {
    if (sessionId === excludeSessionId) continue;
    const projection = await loadSession(sessionId);
    if (projection.session?.status !== 'finished') continue;

    for (const signature of signatures) {
      const candidate = topWorkingSet(
        projection.sets.filter(set => set.comparisonSignature === signature)
      );
      if (candidate == null) continue;
      const current = best.get(signature) ?? null;
      if (
        current == null ||
        candidate.loadKg > current.loadKg ||
        (candidate.loadKg === current.loadKg && candidate.reps > current.reps)
      ) {
        best.set(signature, candidate);
      }
    }
  }
  return best;
}
