import { type ExerciseDefinition } from '@ferrum/domain';

// A history of 278 rows all reading "Workout" is a list you cannot navigate.
// The name is derived from what the session actually trained rather than typed
// in: an imported workout has no title at all, and asking for one retroactively
// on five years of history is not a thing anyone will do.
//
// Derivation, not a lookup table: each exercise's PRIMARY movers decide which
// regions it loads, and the regions present decide the label. Adding an exercise
// to the library therefore classifies itself, and no name here has to be kept in
// sync with anything.

export type BodyRegion = 'push' | 'pull' | 'legs' | 'core';

const REGION_BY_MUSCLE: Readonly<Record<string, BodyRegion>> = {
  pectoralis_major: 'push',
  anterior_deltoid: 'push',
  lateral_deltoid: 'push',
  triceps_brachii: 'push',
  serratus_anterior: 'push',

  latissimus_dorsi: 'pull',
  teres_major: 'pull',
  rhomboids: 'pull',
  trapezius_upper: 'pull',
  trapezius_middle: 'pull',
  trapezius_lower: 'pull',
  posterior_deltoid: 'pull',
  biceps_brachii: 'pull',
  brachialis: 'pull',
  brachioradialis: 'pull',
  forearm_flexors: 'pull',
  rotator_cuff: 'pull',

  quadriceps: 'legs',
  hamstrings: 'legs',
  gluteus_maximus: 'legs',
  gluteus_medius: 'legs',
  adductors: 'legs',
  gastrocnemius: 'legs',
  soleus: 'legs',
  hip_flexors: 'legs',

  rectus_abdominis: 'core',
  obliques: 'core',
  erector_spinae: 'core',
};

export function regionsOf(definition: ExerciseDefinition): ReadonlySet<BodyRegion> {
  const regions = new Set<BodyRegion>();
  for (const role of definition.muscleRoles) {
    if (role.role !== 'primary') continue;
    const region = REGION_BY_MUSCLE[role.muscleId as unknown as string];
    if (region !== undefined) regions.add(region);
  }
  return regions;
}

// Core alone is a session; core alongside anything else is accessory work and
// does not earn a mention, or every leg day would read "Legs & core".
function label(regions: ReadonlySet<BodyRegion>): string {
  const push = regions.has('push');
  const pull = regions.has('pull');
  const legs = regions.has('legs');
  const core = regions.has('core');
  const upper = push || pull;

  if (upper && legs) return 'Full body';
  if (push && pull) return 'Upper body';
  if (push) return 'Push';
  if (pull) return 'Pull';
  if (legs) return 'Legs';
  if (core) return 'Core';
  return 'Workout';
}

/**
 * A name for a session, derived from the exercises it actually contains.
 *
 * `definitions` is every exercise in the session, in order; an unresolved one is
 * simply absent, which is why an empty session falls back to "Workout" rather
 * than claiming something it cannot support.
 */
export function describeSession(definitions: readonly ExerciseDefinition[]): string {
  const regions = new Set<BodyRegion>();
  for (const definition of definitions) {
    for (const region of regionsOf(definition)) regions.add(region);
  }
  return label(regions);
}
