import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { LibraryValidationError, loadExerciseLibrary } from '../src/index.ts';

const LIBRARY_SIZE = 80;

// The names the imported Hevy history uses. They must keep resolving forever: the moment
// one of them stops matching, an import silently creates a second exercise and splits a
// real training history in two.
const IMPORTED_HISTORY_NAMES = [
  'Bench Press (Barbell)',
  'Lat Pulldown (Cable)',
  'Shoulder Press (Machine Plates)',
  'Calf Extension (Machine)',
  'Pendulum Squat (Machine)',
  'Squat (Smith Machine)',
  'T Bar Row',
  'Seated Chest Flys (Cable)',
  'Shoulder Lateral Raise',
  'Dumbbell Row',
  'Bicep Curl (Barbell)',
  'Bicep Curl (Dumbbell)',
  'Triceps Pushdown',
  'Seated Calf Raise',
  'Seated Row (Machine)',
  'Seated Shoulder Press (Machine)',
  'Leg Extension (Machine)',
  'Lying Leg Curl (Machine)',
  'Squat (Machine)',
  'Bench Press (Dumbbell)',
  'Bent Over Row (Barbell)',
  'Shoulder Press (Dumbbell)',
] as const;

interface HistoryFixture {
  readonly sets: readonly { readonly exercise: string }[];
}

function fixtureExerciseNames(): readonly string[] {
  const path = fileURLToPath(
    new URL('../../../fixtures/real-history-2026-06-15_2026-07-25.json', import.meta.url)
  );
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as HistoryFixture;
  return [...new Set(fixture.sets.map(set => set.exercise))];
}

const library = loadExerciseLibrary();

const BODYWEIGHT_SEMANTICS = [
  'bodyweight',
  'bodyweight_plus_external',
  'bodyweight_minus_assistance',
];

describe('exercise library data', () => {
  it('loads exactly the curated set with unique ids and names', () => {
    expect(library.all).toHaveLength(LIBRARY_SIZE);
    expect(new Set(library.all.map(definition => definition.id)).size).toBe(LIBRARY_SIZE);
    expect(new Set(library.all.map(definition => definition.name)).size).toBe(LIBRARY_SIZE);
    expect(library.byId.size).toBe(LIBRARY_SIZE);
    expect(library.byName.size).toBe(LIBRARY_SIZE);
  });

  it('returns the same instance on repeated loads', () => {
    expect(loadExerciseLibrary()).toBe(library);
  });

  it('resolves every exercise name used by the imported history', () => {
    const unresolved = IMPORTED_HISTORY_NAMES.filter(
      name => library.resolveAlias(name) === undefined
    );
    expect(unresolved).toEqual([]);
  });

  it('resolves every exercise name present in the real history fixture', () => {
    const names = fixtureExerciseNames();
    expect(names.length).toBeGreaterThan(0);
    const declared: readonly string[] = IMPORTED_HISTORY_NAMES;
    expect(names.filter(name => !declared.includes(name))).toEqual([]);
    expect(names.filter(name => library.resolveAlias(name) === undefined)).toEqual([]);
  });

  it('references only movements and muscles that exist', () => {
    for (const definition of library.all) {
      expect(library.movements.has(definition.movementId)).toBe(true);
      expect(definition.muscleRoles.length).toBeGreaterThan(0);
      for (const role of definition.muscleRoles) {
        expect(library.muscles.has(role.muscleId)).toBe(true);
      }
    }
  });

  it('gives every muscle role exactly one primary muscle group at minimum', () => {
    for (const definition of library.all) {
      const primaries = definition.muscleRoles.filter(role => role.role === 'primary');
      expect(primaries.length).toBeGreaterThan(0);
    }
  });

  it('keeps bodyweight fractions consistent with load semantics', () => {
    for (const definition of library.all) {
      if (BODYWEIGHT_SEMANTICS.includes(definition.loadSemantics)) {
        expect(definition.bodyweightFraction).toBeGreaterThan(0);
        expect(definition.bodyweightFraction).toBeLessThanOrEqual(1);
      } else {
        expect(definition.bodyweightFraction).toBe(0);
      }
    }
  });

  it('uses per_hand entry only for hand-held implements', () => {
    const offenders = library.all
      .filter(definition => definition.loadEntryMode === 'per_hand')
      .filter(
        definition =>
          definition.equipmentType !== 'dumbbell' && definition.equipmentType !== 'kettlebell'
      );
    expect(offenders.map(definition => definition.name)).toEqual([]);
    expect(library.all.some(definition => definition.loadEntryMode === 'per_hand')).toBe(true);
  });

  it('counts single-limb work as whole reps of the limb that just worked', () => {
    for (const definition of library.all) {
      if (definition.laterality === 'unilateral_isolated') {
        expect(definition.repCountMode).toBe('total');
      }
      if (definition.laterality === 'unilateral_alternating') {
        expect(definition.repCountMode).toBe('alternating_total');
      }
    }
  });

  it('ships every record as an unedited first revision', () => {
    for (const definition of library.all) {
      expect(definition.revision).toBe(1);
      expect(definition.userCreated).toBe(false);
      expect(definition.rangeOfMotionVariant).toBe('full');
      expect(definition.tempoVariant).toBe('standard');
      expect(definition.defaultRestSeconds).toBeGreaterThan(0);
    }
  });

  it('names the record and the field when a record is rejected', () => {
    const error = new LibraryValidationError('bench_press_barbell', 'loadEntryMode', 'nope');
    expect(error.message).toContain('bench_press_barbell');
    expect(error.message).toContain('loadEntryMode');
    expect(error).toBeInstanceOf(Error);
  });
});

const PUNCTUATION = ['-', '_', '.', ',', "'", '(', ')', '/', '&', '!', ':'];

const labelArbitrary = fc.constantFrom(
  ...library.all.flatMap(definition =>
    [definition.name, ...definition.aliases].map(label => ({ label, id: definition.id }))
  )
);

describe('alias resolution', () => {
  it('is invariant to case, surrounding whitespace and punctuation', () => {
    fc.assert(
      fc.property(
        labelArbitrary,
        fc.array(fc.boolean(), { minLength: 0, maxLength: 60 }),
        fc.array(fc.tuple(fc.nat(), fc.constantFrom(...PUNCTUATION)), { maxLength: 8 }),
        fc.constantFrom('', ' ', '   ', '\t', '\n', ' \t '),
        fc.constantFrom('', ' ', '   ', '\t', '\n', ' \t '),
        ({ label, id }, caseFlips, insertions, leading, trailing) => {
          const recased = [...label]
            .map((character, index) =>
              caseFlips[index] === true ? character.toUpperCase() : character.toLowerCase()
            )
            .join('');

          const characters = [...recased];
          for (const [position, mark] of insertions) {
            characters.splice(position % (characters.length + 1), 0, mark);
          }

          const mangled = `${leading}${characters.join('')}${trailing}`;
          expect(library.resolveAlias(mangled)?.id).toBe(id);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('does not invent matches for names outside the library', () => {
    expect(library.resolveAlias('Zercher Sandbag Carry')).toBeUndefined();
    expect(library.resolveAlias('')).toBeUndefined();
  });
});

describe('ranked search', () => {
  const library = loadExerciseLibrary();

  it('puts an exact alias hit above prefix and substring matches', () => {
    const results = library.search('bench press');
    expect(results.length).toBeGreaterThan(1);
    expect(results[0]?.name).toBe('Bench Press (Barbell)');
  });

  it('matches every query token as a word prefix', () => {
    const results = library.search('lat pull');
    expect(results.some(definition => definition.name === 'Lat Pulldown (Cable)')).toBe(true);
    expect(results[0]?.name).toContain('Lat');
  });

  it('finds all variants for a shared movement word', () => {
    const names = library.search('press').map(definition => definition.name);
    expect(names.length).toBeGreaterThan(3);
    expect(names).toContain('Bench Press (Barbell)');
  });

  it('is robust to case and punctuation in the query', () => {
    expect(library.search('  LAT-pull  ')).toStrictEqual(library.search('lat pull'));
  });

  it('returns nothing rather than guessing', () => {
    expect(library.search('')).toStrictEqual([]);
    expect(library.search('zercher sandbag carry')).toStrictEqual([]);
  });

  it('ranks every library name so its own definition comes first', () => {
    for (const definition of library.all) {
      expect(library.search(definition.name)[0]?.id).toBe(definition.id);
    }
  });
});
