import { type ExerciseDefinitionId } from './exercise.ts';
import { addLoad, grams, kilograms, scaleLoad, type Kilograms } from './units.ts';

export type EquipmentInstanceId = string & { readonly __brand: 'EquipmentInstanceId' };
export type GymProfileId = string & { readonly __brand: 'GymProfileId' };
export type EquivalenceGroupId = string & { readonly __brand: 'EquivalenceGroupId' };

export interface EquipmentInstance {
  readonly id: EquipmentInstanceId;
  readonly profileId: GymProfileId;
  readonly exerciseDefinitionId: ExerciseDefinitionId | null;
  readonly name: string;
  readonly manufacturer: string | null;
  readonly barMassKg: Kilograms | null;
  readonly stackIncrementKg: Kilograms | null;
  readonly stackMinimumKg: Kilograms | null;
  readonly pulleyRatio: number | null;
  readonly dumbbellIncrementKg: Kilograms | null;
  readonly availablePlatePairsKg: readonly Kilograms[];
  readonly maximumLoadKg: Kilograms | null;
  // Set by the user when they explicitly declare two machines interchangeable.
  // Until then every instance is its own comparison bucket.
  readonly equivalenceGroupId: EquivalenceGroupId | null;
  readonly notes: string | null;
}

export type LoadIncrementSource = 'stack' | 'dumbbell' | 'plate_pair' | 'definition_default';

export interface SmallestIncrement {
  readonly kilograms: Kilograms;
  readonly source: LoadIncrementSource;
}

export function smallestAvailableIncrement(
  instance: EquipmentInstance | null,
  definitionDefault: Kilograms | null
): SmallestIncrement | null {
  if (instance?.stackIncrementKg != null) {
    return { kilograms: instance.stackIncrementKg, source: 'stack' };
  }
  if (instance?.dumbbellIncrementKg != null) {
    return { kilograms: instance.dumbbellIncrementKg, source: 'dumbbell' };
  }
  if (instance != null && instance.availablePlatePairsKg.length > 0) {
    const smallestPair = instance.availablePlatePairsKg.reduce((min, plate) =>
      grams(plate) < grams(min) ? plate : min
    );
    return { kilograms: scaleLoad(smallestPair, 2), source: 'plate_pair' };
  }
  if (definitionDefault != null) {
    return { kilograms: definitionDefault, source: 'definition_default' };
  }
  return null;
}

export type RoundingDirection = 'nearest' | 'down' | 'up';

export function roundToAvailableLoad(
  target: Kilograms,
  instance: EquipmentInstance | null,
  definitionDefault: Kilograms | null,
  direction: RoundingDirection = 'nearest'
): Kilograms {
  const increment = smallestAvailableIncrement(instance, definitionDefault);
  if (increment == null) return target;

  const base = instance?.stackMinimumKg ?? instance?.barMassKg ?? kilograms(0);
  const step = grams(increment.kilograms);
  if (step <= 0) return target;

  const offset = grams(target) - grams(base);
  const steps =
    direction === 'down'
      ? Math.floor(offset / step)
      : direction === 'up'
        ? Math.ceil(offset / step)
        : Math.round(offset / step);

  const rounded = kilograms((grams(base) + Math.max(0, steps) * step) / 1000);
  if (instance?.maximumLoadKg != null && grams(rounded) > grams(instance.maximumLoadKg)) {
    return instance.maximumLoadKg;
  }
  return rounded;
}

export interface PlateSolution {
  readonly perSide: readonly Kilograms[];
  readonly achievedTotalKg: Kilograms;
  readonly residualKg: Kilograms;
  readonly exact: boolean;
}

export class BarNotConfigured extends Error {
  constructor(readonly instanceId: EquipmentInstanceId) {
    super(
      `Equipment instance ${instanceId} has no bar mass configured; plate maths is not defined for it`
    );
    this.name = 'BarNotConfigured';
  }
}

// Greedy is provably optimal only for canonical plate sets. Real gyms are canonical
// (each plate is at least twice the next one down) often enough that greedy plus an
// honest residual beats a search the user has to wait for between sets.
export function solvePlates(targetTotal: Kilograms, instance: EquipmentInstance): PlateSolution {
  if (instance.barMassKg == null) {
    throw new BarNotConfigured(instance.id);
  }

  const perSideTargetGrams = (grams(targetTotal) - grams(instance.barMassKg)) / 2;
  if (perSideTargetGrams <= 0) {
    return {
      perSide: [],
      achievedTotalKg: instance.barMassKg,
      residualKg: kilograms((grams(targetTotal) - grams(instance.barMassKg)) / 1000),
      exact: grams(targetTotal) === grams(instance.barMassKg),
    };
  }

  const descending = [...instance.availablePlatePairsKg].sort((a, b) => grams(b) - grams(a));
  const chosen: Kilograms[] = [];
  let remaining = perSideTargetGrams;

  for (const plate of descending) {
    const plateGrams = grams(plate);
    if (plateGrams <= 0) continue;
    while (remaining >= plateGrams) {
      chosen.push(plate);
      remaining -= plateGrams;
    }
  }

  const achieved = chosen.reduce<Kilograms>(
    (total, plate) => addLoad(total, scaleLoad(plate, 2)),
    instance.barMassKg
  );

  return {
    perSide: chosen,
    achievedTotalKg: achieved,
    residualKg: kilograms((grams(targetTotal) - grams(achieved)) / 1000),
    exact: remaining === 0,
  };
}
