import { type Kilograms, type WeightUnit, displayLoad } from '@ferrum/domain';
import { db } from '../db/ferrum-db.ts';

export async function loadUnit(): Promise<WeightUnit> {
  const record = await db.settings.get('settings');
  return record?.key === 'settings' ? record.unit : 'kg';
}

export async function saveUnit(unit: WeightUnit): Promise<void> {
  await db.settings.put({ key: 'settings', unit });
}

// Steppers work in the display unit; two decimals is enough to round-trip any
// gram-exact kilogram value through pounds and back without visible drift.
export function displayStep(stepKg: Kilograms, unit: WeightUnit): number {
  if (unit === 'kg') return stepKg;
  const converted = displayLoad(stepKg, unit);
  return converted > 0 ? converted : 1;
}
