import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { LibraryValidationError, loadExerciseLibrary } from '../src/index.ts';

// 93 at first curation; 117 once the imported history's own vocabulary was
// covered end to end; 118 with the bodyweight crunch that history had been
// filing under the cable one; 120 with the two standing cable crossovers whose
// names had been aliases of the seated fly. The count is asserted so growth stays
// deliberate — a definition added to make one import pass is a duplicate waiting
// to happen.
const LIBRARY_SIZE = 120;

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

  // loadEntryMode is chosen from the equipment — barbell totals, dumbbell per
  // hand, a stack marking that is not kilograms at all. So an alias that files
  // "Upright Row (Barbell)" under a cable definition does not just mislabel the
  // row, it changes what its number means. Cross-equipment aliases were how the
  // first pass at covering the imported history went wrong, on 158 sets.
  it('never files a name under a contradicting equipment class', () => {
    const stated = (name: string): string | null => {
      const lowered = name.toLowerCase();
      // Before the generic machine test: a Smith machine is its own equipment
      // type, and the aliases spell it with and without parentheses.
      if (lowered.includes('smith machine')) return 'smith_machine';
      if (lowered.includes('(barbell)')) return 'barbell';
      if (lowered.includes('(dumbbell)')) return 'dumbbell';
      if (lowered.includes('(cable)')) return 'cable';
      if (lowered.includes('machine')) return 'machine';
      return null;
    };
    const actual = (equipmentType: string): string =>
      equipmentType === 'machine_stack' || equipmentType === 'machine_plate_loaded'
        ? 'machine'
        : equipmentType;

    // Every alias in the library, not a sample: the whole point is to catch the
    // next one somebody adds.
    const contradictions: string[] = [];
    for (const definition of library.all) {
      for (const name of [definition.name, ...definition.aliases]) {
        const claimed = stated(name);
        if (claimed === null) continue;
        if (actual(definition.equipmentType) !== claimed) {
          contradictions.push(`${name} -> ${definition.id} (${definition.equipmentType})`);
        }
      }
    }
    expect(contradictions).toEqual([]);
  });

  // `external` is a claim that the entered number is kilograms at the hands. On a
  // selectorized stack it is a marking on a pulley of unknown ratio, and the two
  // are not interchangeable: `external` reports calibrated: true, so the number
  // flows into volume and e1RM as if it had been weighed. Three lat-machine
  // exercises were typed this way while every other exercise on the same stack
  // was not, which made one physical machine speak in two units.
  it('never presents a stack marking as measured kilograms', () => {
    const onAStack = library.all.filter(
      definition =>
        definition.equipmentType === 'cable' || definition.equipmentType === 'machine_stack'
    );
    expect(onAStack.length).toBeGreaterThan(0);
    const claimingKilograms = onAStack.filter(
      definition => definition.loadSemantics === 'external'
    );
    expect(claimingKilograms.map(definition => definition.name)).toEqual([]);
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
          const recased = Array.from(label)
            .map((character, index) =>
              caseFlips[index] === true ? character.toUpperCase() : character.toLowerCase()
            )
            .join('');

          const characters = Array.from(recased);
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

  // These names used to resolve onto the seated cable fly, which is a different
  // movement performed on a different apparatus. Pinned so nobody restores them
  // there while tidying the alias lists.
  it('files the crossovers under the standing crossovers, not the seated fly', () => {
    expect(library.resolveAlias('Cable Crossover')?.id).toBe('cable_crossover_high');
    expect(library.resolveAlias('Low Cable Fly Crossovers')?.id).toBe('cable_crossover_low');
    expect(library.resolveAlias('Low Cable Crossover')?.id).toBe('cable_crossover_low');
    expect(library.resolveAlias('Seated Chest Flys (Cable)')?.id).toBe('seated_chest_fly_cable');
  });
});

// Grouping is what the picker shows; it is never what the log records. These tests
// hold that line: the group carries no identity of its own, so merging tiles can
// never merge the histories underneath them.
describe('variant groups', () => {
  it('places every definition in exactly one group', () => {
    const placed = library.groups.flatMap(group => group.variants.map(v => v.definition.id));
    expect(new Set(placed).size).toBe(library.all.length);
    for (const definition of library.all) {
      expect(library.groupOf(definition.id)?.variants.map(v => v.definition.id)).toContain(
        definition.id
      );
    }
  });

  it('labels the members of a shared group and leaves a solitary one unlabelled', () => {
    const bench = library.groups.find(group => group.id === 'bench_press');
    expect(bench?.name).toBe('Bench Press');
    expect(bench?.variants.map(variant => variant.variantLabel)).toEqual([
      'Barbell',
      'Dumbbell',
      'Smith Machine',
      'Machine',
      'Machine (Plates)',
      'Cable',
    ]);

    const solitary = library.groupOf('chin_up' as never);
    expect(solitary?.variants).toHaveLength(1);
    expect(solitary?.variants[0]?.variantLabel).toBeNull();
  });

  it('keeps a group inside one movement and its labels distinct', () => {
    for (const group of library.groups) {
      expect(group.variants.length).toBeGreaterThan(0);
      const movements = new Set(group.variants.map(variant => variant.definition.movementId));
      expect(movements.size).toBe(1);
      const labels = group.variants.map(variant => variant.variantLabel);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('never lets two variants of one group share a comparison identity', () => {
    for (const group of library.groups) {
      const identities = group.variants.map(variant =>
        [
          variant.definition.id,
          variant.definition.loadSemantics,
          variant.definition.loadEntryMode,
        ].join('|')
      );
      expect(new Set(identities).size).toBe(identities.length);
    }
  });

  it('ranks the family a query names above the rest', () => {
    expect(library.searchGroups('bench press')[0]?.id).toBe('bench_press');
    expect(library.searchGroups('pull up')[0]?.id).toBe('pull_up');
    expect(library.searchGroups('')).toStrictEqual([]);
  });

  it('finds the low crossover that used to be missing', () => {
    const groups = library.searchGroups('crossover');
    const found = groups
      .flatMap(group => group.variants)
      .map(variant => variant.definition.id)
      .filter(id => id.startsWith('cable_crossover'));
    expect(found).toContain('cable_crossover_low');
    expect(found).toContain('cable_crossover_high');
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

// The library is curated, not exhaustive, but "curated" has to mean somebody decided
// rather than nobody noticed. These two tests are the audit: they fail when a muscle or
// a movement pattern the vocabulary declares has nothing that actually trains it.
describe('exercise library coverage', () => {
  // Two muscles have no exercise that trains them as a primary mover, and neither is an
  // oversight. Teres major only ever assists the lats — there is no isolation for it.
  // Lower trapezius is trained primarily by prone Y raises, which need a movement pattern
  // of their own for one niche exercise. Both are decisions; delete an entry here only
  // when the exercise exists.
  const NO_PRIMARY_BY_DESIGN = new Set(['teres_major', 'trapezius_lower']);

  it('trains every muscle it names as a primary mover', () => {
    const primaries = new Set(
      library.all.flatMap(definition =>
        definition.muscleRoles.filter(role => role.role === 'primary').map(role => role.muscleId)
      )
    );
    for (const muscleId of library.muscles.keys()) {
      if (NO_PRIMARY_BY_DESIGN.has(muscleId)) continue;
      expect(primaries.has(muscleId), `${muscleId} has no primary exercise`).toBe(true);
    }
  });

  it('leaves no declared movement pattern without an exercise', () => {
    const covered = new Set(
      library.all.map(definition => library.movements.get(definition.movementId)?.pattern)
    );
    for (const movement of library.movements.values()) {
      expect(covered.has(movement.pattern), `${movement.pattern} has no exercise`).toBe(true);
    }
  });

  it('gives every movement family at least one exercise', () => {
    const used = new Set(library.all.map(definition => definition.movementId));
    for (const movementId of library.movements.keys()) {
      expect(used.has(movementId), `movement ${movementId} is unused`).toBe(true);
    }
  });
});
