export type LocalDate = string & { readonly __brand: 'LocalDate' };
export type Instant = number & { readonly __brand: 'Instant' };

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface LocalTimestamp {
  readonly instant: Instant;
  readonly tzOffsetMinutes: number;
}

const MILLIS_PER_MINUTE = 60_000;
const MILLIS_PER_DAY = 86_400_000;

export function instant(epochMillis: number): Instant {
  if (!Number.isFinite(epochMillis)) {
    throw new RangeError(
      `Instant must be a finite epoch-millisecond value, received ${String(epochMillis)}`
    );
  }
  return Math.trunc(epochMillis) as Instant;
}

export function localDate(value: string): LocalDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`LocalDate must be ISO yyyy-mm-dd, received "${value}"`);
  }
  return value as LocalDate;
}

// The session records the offset that was in force when it happened, and every
// weekly rollup reads that stored offset back. A later timezone change moves the
// user, not their history.
export function toLocalDate(timestamp: LocalTimestamp): LocalDate {
  const shifted = new Date(timestamp.instant + timestamp.tzOffsetMinutes * MILLIS_PER_MINUTE);
  const year = shifted.getUTCFullYear().toString().padStart(4, '0');
  const month = (shifted.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = shifted.getUTCDate().toString().padStart(2, '0');
  return localDate(`${year}-${month}-${day}`);
}

export function localDateToUtcMillis(date: LocalDate): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

export function weekdayOf(date: LocalDate): Weekday {
  return new Date(localDateToUtcMillis(date)).getUTCDay() as Weekday;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(localDateToUtcMillis(date) + days * MILLIS_PER_DAY);
  return toLocalDate({ instant: instant(shifted.getTime()), tzOffsetMinutes: 0 });
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((localDateToUtcMillis(to) - localDateToUtcMillis(from)) / MILLIS_PER_DAY);
}

export function startOfWeek(date: LocalDate, firstDayOfWeek: Weekday): LocalDate {
  const offset = (weekdayOf(date) - firstDayOfWeek + 7) % 7;
  return addDays(date, -offset);
}

export function weekKey(date: LocalDate, firstDayOfWeek: Weekday): string {
  return startOfWeek(date, firstDayOfWeek);
}

export function compareLocalDate(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
