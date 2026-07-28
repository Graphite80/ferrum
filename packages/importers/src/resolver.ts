import { comparisonSignature, type ExerciseDefinition } from '@ferrum/domain';
import { normalizeExerciseName, type ExerciseLibrary } from '@ferrum/exercise-library';
import { type ExerciseMatch, type ExerciseResolver } from './pipeline.ts';

// resolveAlias only, never search(): the resolver's verdict becomes an immutable
// comparison signature on every imported set, so a fuzzy guess here would silently
// weld history onto the wrong exercise. Unmatched rows are held back for the user.
export function libraryResolver(library: ExerciseLibrary): ExerciseResolver {
  return {
    resolve(rawName: string): ExerciseMatch {
      const definition = library.resolveAlias(rawName);
      if (definition === undefined) {
        return { exerciseDefinitionId: rawName, matchKind: 'unmatched' };
      }
      return libraryMatch(definition, rawName);
    },
  };
}

export function libraryMatch(definition: ExerciseDefinition, rawName: string): ExerciseMatch {
  const matchKind =
    normalizeExerciseName(definition.name) === normalizeExerciseName(rawName) ? 'exact' : 'alias';
  return {
    exerciseDefinitionId: definition.id,
    matchKind,
    comparisonSignature: comparisonSignature(definition, null),
  };
}
