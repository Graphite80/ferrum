import { describe, expect, it } from 'vitest';
import { describeSession, loadExerciseLibrary, regionsOf } from '../src/index.ts';
import { type ExerciseDefinition } from '@ferrum/domain';

const library = loadExerciseLibrary();

function pick(...ids: readonly string[]): readonly ExerciseDefinition[] {
  return ids.map(id => {
    const definition = library.byId.get(id as never);
    if (definition === undefined) throw new Error(`no exercise ${id}`);
    return definition;
  });
}

describe('naming a session from what it trained', () => {
  it.each([
    ['Push', ['bench_press_barbell', 'overhead_press_barbell', 'triceps_pushdown']],
    ['Pull', ['lat_pulldown_cable', 'bent_over_row_barbell', 'bicep_curl_barbell']],
    ['Legs', ['squat_barbell', 'leg_extension_machine', 'lying_leg_curl_machine']],
    ['Upper body', ['bench_press_barbell', 'lat_pulldown_cable']],
    ['Full body', ['bench_press_barbell', 'squat_barbell']],
    ['Core', ['plank', 'cable_crunch']],
  ])('calls a session %s', (expected, ids) => {
    expect(describeSession(pick(...ids))).toBe(expected);
  });

  it('does not let accessory core rename a leg day', () => {
    // Otherwise every session ending in planks reads "Legs & core", which is
    // noise on a list of hundreds.
    expect(describeSession(pick('squat_barbell', 'plank'))).toBe('Legs');
  });

  it('falls back rather than inventing a name it cannot support', () => {
    expect(describeSession([])).toBe('Workout');
  });

  // The label is derived from primary movers, so a new exercise classifies
  // itself. This is the assertion that keeps that true.
  it('assigns a region to every exercise in the library', () => {
    const unclassified = library.all.filter(definition => regionsOf(definition).size === 0);
    expect(unclassified.map(definition => definition.name)).toEqual([]);
  });

  it('names every distinct session shape the library can produce', () => {
    const labels = new Set(library.all.map(definition => describeSession([definition])));
    expect(labels.has('Workout')).toBe(false);
  });
});
