export type WeightUnit = 'kg' | 'lb';

export type Kilograms = number & { readonly __brand: 'Kilograms' };

const KILOGRAMS_PER_POUND = 0.45359237;
const GRAMS_PER_KILOGRAM = 1000;

// All comparison, hashing and equality in the domain runs on integer grams.
// Storing kilograms as raw floats makes 2.5 + 2.5 + 20 !== 25 on some paths,
// which would silently split a comparison signature and fork an exercise history.
export function kilograms(value: number): Kilograms {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Load must be a finite number, received ${String(value)}`);
  }
  return (Math.round(value * GRAMS_PER_KILOGRAM) / GRAMS_PER_KILOGRAM) as Kilograms;
}

export function grams(value: Kilograms): number {
  return Math.round(value * GRAMS_PER_KILOGRAM);
}

export function sameLoad(a: Kilograms, b: Kilograms): boolean {
  return grams(a) === grams(b);
}

export function addLoad(a: Kilograms, b: Kilograms): Kilograms {
  return kilograms((grams(a) + grams(b)) / GRAMS_PER_KILOGRAM);
}

export function subtractLoad(a: Kilograms, b: Kilograms): Kilograms {
  return kilograms((grams(a) - grams(b)) / GRAMS_PER_KILOGRAM);
}

export function scaleLoad(a: Kilograms, factor: number): Kilograms {
  return kilograms(a * factor);
}

export function toKilograms(value: number, unit: WeightUnit): Kilograms {
  return kilograms(unit === 'kg' ? value : value * KILOGRAMS_PER_POUND);
}

export function fromKilograms(value: Kilograms, unit: WeightUnit): number {
  return unit === 'kg' ? value : value / KILOGRAMS_PER_POUND;
}

export function displayLoad(value: Kilograms, unit: WeightUnit, fractionDigits = 2): number {
  return Number(fromKilograms(value, unit).toFixed(fractionDigits));
}

export interface LoadFormat {
  readonly unit?: WeightUnit;
  readonly fractionDigits?: number;
  readonly withUnit?: boolean;
  readonly nullAs?: string;
}

export function formatLoad(value: Kilograms | null, format: LoadFormat = {}): string {
  const { unit = 'kg', fractionDigits = 1, withUnit = true, nullAs = '—' } = format;
  if (value == null) return nullAs;
  const rounded = String(displayLoad(value, unit, fractionDigits));
  return withUnit ? `${rounded} ${unit}` : rounded;
}
