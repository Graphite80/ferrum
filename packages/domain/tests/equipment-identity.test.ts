import { describe, expect, it } from 'vitest';
import {
  type EquipmentInstance,
  type EquipmentInstanceId,
  type EquivalenceGroupId,
  type ExerciseDefinition,
  type ExerciseDefinitionId,
  type GymProfileId,
  type MovementId,
  type MuscleId,
  comparisonSignature,
  describeIncomparability,
  equipmentIdentityMatters,
  isComparable,
  kilograms,
} from '../src/index.ts';

const definition: ExerciseDefinition = {
  id: 'chest_press_machine' as ExerciseDefinitionId,
  movementId: 'horizontal_press' as MovementId,
  name: 'Chest Press (Machine)',
  aliases: [],
  equipmentType: 'machine_stack',
  laterality: 'bilateral',
  loadSemantics: 'machine_stack',
  loadEntryMode: 'total',
  repCountMode: 'total',
  rangeOfMotionVariant: 'full',
  tempoVariant: 'standard',
  bodyweightFraction: 0,
  muscleRoles: [{ muscleId: 'pectoralis_major' as MuscleId, role: 'primary' }],
  defaultRestSeconds: 120,
  defaultIncrementKg: kilograms(5),
  userCreated: false,
  revision: 1,
};

function machine(id: string, manufacturer: string | null): EquipmentInstance {
  return {
    id: id as EquipmentInstanceId,
    profileId: 'local' as GymProfileId,
    exerciseDefinitionId: definition.id,
    name: id,
    manufacturer,
    barMassKg: null,
    stackIncrementKg: kilograms(5),
    stackMinimumKg: null,
    pulleyRatio: null,
    dumbbellIncrementKg: null,
    availablePlatePairsKg: [],
    maximumLoadKg: null,
    equivalenceGroupId: null,
    notes: null,
  };
}

describe('machine identity', () => {
  it('never compares a stack marking across two machines', () => {
    const home = comparisonSignature(definition, machine('home', 'Technogym'));
    const travel = comparisonSignature(definition, machine('hotel', 'Life Fitness'));

    expect(isComparable(home, travel)).toBe(false);
    expect(describeIncomparability(home, travel)).toStrictEqual(['equipmentKey: home vs hotel']);
  });

  it('never compares a named machine with an unrecorded one', () => {
    const named = comparisonSignature(definition, machine('home', 'Technogym'));
    const anonymous = comparisonSignature(definition, null);

    expect(isComparable(named, anonymous)).toBe(false);
  });

  // The only mechanism that merges two machines is the user saying they are the same
  // (INVARIANTS §1). Identical manufacturers must not be enough: two Technogym chest
  // presses of different vintages are still two different pulley ratios.
  it('merges two machines only through a declared equivalence group', () => {
    const group = 'chest-press-club' as EquivalenceGroupId;
    const left = comparisonSignature(definition, {
      ...machine('home', 'Technogym'),
      equivalenceGroupId: group,
    });
    const right = comparisonSignature(definition, {
      ...machine('hotel', 'Technogym'),
      equivalenceGroupId: group,
    });
    const sameMakeUngrouped = comparisonSignature(definition, machine('hotel', 'Technogym'));

    expect(isComparable(left, right)).toBe(true);
    expect(isComparable(left, sameMakeUngrouped)).toBe(false);
  });

  it('asks for a machine exactly where the number is machine-specific', () => {
    expect(equipmentIdentityMatters('machine_stack')).toBe(true);
    expect(equipmentIdentityMatters('machine_plate_loaded')).toBe(true);
    expect(equipmentIdentityMatters('smith_machine')).toBe(true);
    expect(equipmentIdentityMatters('cable')).toBe(true);

    // A kilogram of iron in the hand is a kilogram in every gym.
    expect(equipmentIdentityMatters('barbell')).toBe(false);
    expect(equipmentIdentityMatters('dumbbell')).toBe(false);
    expect(equipmentIdentityMatters('kettlebell')).toBe(false);
    expect(equipmentIdentityMatters('bodyweight')).toBe(false);
  });
});
