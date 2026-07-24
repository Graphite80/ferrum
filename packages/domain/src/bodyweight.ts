import { daysBetween, type LocalDate } from './time.ts';
import { grams, kilograms, type Kilograms } from './units.ts';

export type BodyweightSource = 'measured_today' | 'interpolated' | 'last_known' | 'default_profile';

export interface BodyweightMeasurement {
  readonly date: LocalDate;
  readonly kilograms: Kilograms;
}

export interface BodyweightSnapshot {
  readonly kilograms: Kilograms;
  readonly source: BodyweightSource;
  readonly ageDays: number;
  readonly qualifiesAsEvidence: boolean;
}

export const MAX_INTERPOLATION_SPAN_DAYS = 14;
export const MAX_EVIDENCE_AGE_DAYS = 30;

export function resolveBodyweight(
  onDate: LocalDate,
  measurements: readonly BodyweightMeasurement[],
  defaultProfileKg: Kilograms | null
): BodyweightSnapshot | null {
  const sorted = [...measurements].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const exact = sorted.find(m => m.date === onDate);
  if (exact != null) {
    return {
      kilograms: exact.kilograms,
      source: 'measured_today',
      ageDays: 0,
      qualifiesAsEvidence: true,
    };
  }

  const before = findLast(sorted, m => m.date < onDate);
  const after = sorted.find(m => m.date > onDate);

  if (
    before != null &&
    after != null &&
    daysBetween(before.date, after.date) <= MAX_INTERPOLATION_SPAN_DAYS
  ) {
    return {
      kilograms: interpolate(before, after, onDate),
      source: 'interpolated',
      ageDays: daysBetween(before.date, onDate),
      qualifiesAsEvidence: true,
    };
  }

  if (before != null) {
    const ageDays = daysBetween(before.date, onDate);
    return {
      kilograms: before.kilograms,
      source: 'last_known',
      ageDays,
      qualifiesAsEvidence: ageDays <= MAX_EVIDENCE_AGE_DAYS,
    };
  }

  if (defaultProfileKg != null) {
    return {
      kilograms: defaultProfileKg,
      source: 'default_profile',
      ageDays: Number.POSITIVE_INFINITY,
      qualifiesAsEvidence: false,
    };
  }

  return null;
}

function interpolate(
  before: BodyweightMeasurement,
  after: BodyweightMeasurement,
  onDate: LocalDate
): Kilograms {
  const span = daysBetween(before.date, after.date);
  const elapsed = daysBetween(before.date, onDate);
  const delta = grams(after.kilograms) - grams(before.kilograms);
  return kilograms((grams(before.kilograms) + (delta * elapsed) / span) / 1000);
}

function findLast<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item !== undefined && predicate(item)) return item;
  }
  return undefined;
}
