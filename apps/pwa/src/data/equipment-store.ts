import {
  type EquipmentInstance,
  type EquipmentInstanceId,
  type ExerciseDefinitionId,
  type GymProfileId,
  kilograms,
} from '@ferrum/domain';
import { db, type EquipmentRecord, withDatabaseRecovery } from '../db/ferrum-db.ts';
import { ulidFactory } from '../platform/ids.ts';

// Machines are device-local for now: they are not in the sync wire format, so a
// profile id would be a foreign key to nothing. One constant keeps the domain type
// satisfied without pretending there is a gym registry behind it.
const LOCAL_PROFILE = 'local' as GymProfileId;

export async function listEquipment(
  definitionId: ExerciseDefinitionId
): Promise<readonly EquipmentRecord[]> {
  return withDatabaseRecovery(async () => {
    const records = await db.equipment.where('exerciseDefinitionId').equals(definitionId).toArray();
    return records.sort((a, b) => b.lastUsedAtMillis - a.lastUsedAtMillis);
  });
}

export async function listAllEquipment(): Promise<readonly EquipmentRecord[]> {
  return withDatabaseRecovery(() => db.equipment.toArray());
}

export async function addEquipment(input: {
  readonly definitionId: ExerciseDefinitionId;
  readonly name: string;
  readonly manufacturer: string | null;
  readonly stackIncrementKg: number | null;
  readonly nowMillis: number;
}): Promise<EquipmentRecord> {
  const record: EquipmentRecord = {
    id: ulidFactory.next(input.nowMillis),
    exerciseDefinitionId: input.definitionId,
    name: input.name.trim(),
    manufacturer: input.manufacturer?.trim() === '' ? null : (input.manufacturer?.trim() ?? null),
    stackIncrementKg: input.stackIncrementKg,
    lastUsedAtMillis: input.nowMillis,
  };
  await withDatabaseRecovery(() => db.equipment.put(record));
  return record;
}

// Selection is recency, not a separate pointer: the machine you last used on an
// exercise is the one you are standing at again, and a stale pointer to a deleted
// machine is a bug waiting for the second gym.
export async function markEquipmentUsed(id: string, nowMillis: number): Promise<void> {
  await withDatabaseRecovery(() => db.equipment.update(id, { lastUsedAtMillis: nowMillis }));
}

export async function removeEquipment(id: string): Promise<void> {
  await withDatabaseRecovery(() => db.equipment.delete(id));
}

export function toEquipmentInstance(record: EquipmentRecord): EquipmentInstance {
  return {
    id: record.id as EquipmentInstanceId,
    profileId: LOCAL_PROFILE,
    exerciseDefinitionId: record.exerciseDefinitionId as ExerciseDefinitionId,
    name: record.name,
    manufacturer: record.manufacturer,
    barMassKg: null,
    stackIncrementKg: record.stackIncrementKg == null ? null : kilograms(record.stackIncrementKg),
    stackMinimumKg: null,
    pulleyRatio: null,
    dumbbellIncrementKg: null,
    availablePlatePairsKg: [],
    maximumLoadKg: null,
    equivalenceGroupId: null,
    notes: null,
  };
}

export function describeEquipment(record: EquipmentRecord): string {
  return record.manufacturer == null ? record.name : `${record.manufacturer} ${record.name}`;
}
