import { type EquipmentInstance } from './equipment.ts';
import { type ExerciseDefinition } from './exercise.ts';
import { addLoad, grams, kilograms, scaleLoad, subtractLoad, type Kilograms } from './units.ts';

export type IndeterminateReason =
  | 'band_resistance_not_calibrated'
  | 'chain_resistance_not_calibrated'
  | 'bodyweight_unknown'
  | 'machine_stack_uncalibrated'
  | 'bar_mass_unknown';

export type ResolvedLoad =
  | { readonly kind: 'load'; readonly systemKg: Kilograms; readonly calibrated: boolean }
  | { readonly kind: 'not_load_bearing' }
  | { readonly kind: 'indeterminate'; readonly reason: IndeterminateReason };

export interface LoadInputs {
  readonly enteredKg: Kilograms;
  readonly definition: ExerciseDefinition;
  readonly instance: EquipmentInstance | null;
  readonly bodyweightKg: Kilograms | null;
}

// One equation for all of calisthenics produces garbage: a push-up is not 100% of
// bodyweight, a pull-up is bodyweight plus added minus assistance, and a stack
// marked "50" is a marking, not a mass. Every branch here is a different physical
// claim, and the ones we cannot honestly compute return `indeterminate` rather than
// a plausible number.
export function resolveLoad(inputs: LoadInputs): ResolvedLoad {
  const { definition, instance, enteredKg, bodyweightKg } = inputs;

  switch (definition.loadSemantics) {
    case 'time':
    case 'distance':
    case 'repetitions_only':
      return { kind: 'not_load_bearing' };

    case 'band':
      return { kind: 'indeterminate', reason: 'band_resistance_not_calibrated' };

    case 'chain':
      return { kind: 'indeterminate', reason: 'chain_resistance_not_calibrated' };

    case 'external':
      return externalLoad(enteredKg, definition, instance);

    case 'machine_stack': {
      const marking = externalLoad(enteredKg, definition, instance);
      if (marking.kind !== 'load') return marking;
      const ratio = instance?.pulleyRatio;
      if (ratio == null) {
        return { kind: 'load', systemKg: marking.systemKg, calibrated: false };
      }
      return { kind: 'load', systemKg: scaleLoad(marking.systemKg, ratio), calibrated: true };
    }

    case 'bodyweight': {
      if (bodyweightKg == null) return { kind: 'indeterminate', reason: 'bodyweight_unknown' };
      return {
        kind: 'load',
        systemKg: scaleLoad(bodyweightKg, definition.bodyweightFraction),
        calibrated: true,
      };
    }

    case 'bodyweight_plus_external': {
      if (bodyweightKg == null) return { kind: 'indeterminate', reason: 'bodyweight_unknown' };
      const added = externalLoad(enteredKg, definition, instance);
      if (added.kind !== 'load') return added;
      const carried = scaleLoad(bodyweightKg, definition.bodyweightFraction);
      return { kind: 'load', systemKg: addLoad(carried, added.systemKg), calibrated: true };
    }

    case 'bodyweight_minus_assistance': {
      if (bodyweightKg == null) return { kind: 'indeterminate', reason: 'bodyweight_unknown' };
      const assistance = externalLoad(enteredKg, definition, instance);
      if (assistance.kind !== 'load') return assistance;
      const carried = scaleLoad(bodyweightKg, definition.bodyweightFraction);
      const net = subtractLoad(carried, assistance.systemKg);
      return { kind: 'load', systemKg: grams(net) > 0 ? net : kilograms(0), calibrated: true };
    }
  }
}

function externalLoad(
  enteredKg: Kilograms,
  definition: ExerciseDefinition,
  instance: EquipmentInstance | null
): ResolvedLoad {
  switch (definition.loadEntryMode) {
    case 'total':
    case 'added_only':
      return { kind: 'load', systemKg: enteredKg, calibrated: true };

    case 'per_hand':
      return { kind: 'load', systemKg: scaleLoad(enteredKg, 2), calibrated: true };

    case 'per_side': {
      const barMass = instance?.barMassKg;
      if (barMass == null) return { kind: 'indeterminate', reason: 'bar_mass_unknown' };
      return {
        kind: 'load',
        systemKg: addLoad(scaleLoad(enteredKg, 2), barMass),
        calibrated: true,
      };
    }
  }
}

export function totalRepsPerformed(reps: number, definition: ExerciseDefinition): number {
  switch (definition.repCountMode) {
    case 'total':
    case 'alternating_total':
      return reps;
    case 'per_side':
      return reps * 2;
  }
}
