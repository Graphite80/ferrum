import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { comparisonSignature, type ExerciseDefinitionId } from '@ferrum/domain';
import { loadExerciseLibrary } from '@ferrum/exercise-library';
import { libraryResolver, type LifeAsCodeSetRow } from '../src/index.ts';

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/real-history-2026-06-15_2026-07-25.json'
);

const document = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  readonly sets: readonly LifeAsCodeSetRow[];
};

describe('libraryResolver against the real exercise library', () => {
  const library = loadExerciseLibrary();
  const resolver = libraryResolver(library);

  it('resolves every exercise name in the real training history', () => {
    const names = [...new Set(document.sets.map(row => row.exercise))].sort();
    expect(names).toHaveLength(18);

    for (const name of names) {
      const match = resolver.resolve(name);
      expect(match.matchKind, name).not.toBe('unmatched');
      const definition = library.byId.get(match.exerciseDefinitionId as ExerciseDefinitionId);
      expect(definition, name).toBeDefined();
      expect(match.comparisonSignature).toBe(comparisonSignature(definition!, null));
    }
  });

  it('tells an exact name hit apart from an alias hit', () => {
    expect(resolver.resolve('Bench Press (Barbell)').matchKind).toBe('exact');
    expect(resolver.resolve('  bench PRESS (barbell)! ').matchKind).toBe('exact');

    const aliasMatch = resolver.resolve('Shoulder Lateral Raise');
    expect(aliasMatch.matchKind).toBe('alias');
    expect(aliasMatch.exerciseDefinitionId).toBe('lateral_raise_machine');
  });

  it('never guesses: an unknown name comes back unmatched, not searched', () => {
    const match = resolver.resolve('Quantum Flux Press');
    expect(match.matchKind).toBe('unmatched');
    expect(match.comparisonSignature).toBeUndefined();
    expect(library.search('press').length).toBeGreaterThan(0);
  });
});
