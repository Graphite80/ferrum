import { type ExerciseDefinition, comparisonSignature } from '@ferrum/domain';
import {
  db,
  type RoutineRecord,
  type RoutineSlotRecord,
  type SessionPlanRecord,
} from '../db/ferrum-db.ts';
import { ulidFactory } from '../platform/ids.ts';

function seedSlot(
  id: string,
  name: string,
  targetLoadKg: number,
  restSeconds: number,
  incrementKg: number
): RoutineSlotRecord {
  return {
    exerciseDefinitionId: id,
    name,
    // No signature: this layer cannot see the library, and the one it used to
    // assemble by hand claimed machine_stack semantics for every slot including
    // a plate-loaded press. planExercise computes the real one.
    sets: 4,
    targetLoadKg,
    targetRepMin: 8,
    targetRepMax: 12,
    targetRirMin: 1,
    targetRirMax: 3,
    incrementKg,
    restSeconds,
  };
}

// Seeded from the loads actually present in the real training history so a first
// boot starts with plausible numbers rather than invented ones. Inserted once;
// afterwards the routines table is entirely user-owned.
function seedRoutine(nowMillis: number): RoutineRecord {
  return {
    id: 'seed-full-body',
    name: 'Full body A',
    // The ids are the library's own, spelled exactly. They were hyphenated here
    // while the library uses underscores, and because history is looked up by
    // this id, a lifter with five years of squats opened the starter routine and
    // was told there was no previous set for any of it.
    slots: [
      seedSlot('squat_machine', 'Squat (Machine)', 80, 180, 5),
      seedSlot('lat_pulldown_cable', 'Lat Pulldown (Cable)', 65, 150, 5),
      seedSlot('shoulder_press_machine_plates', 'Shoulder Press (Machine Plates)', 45, 150, 5),
      seedSlot('triceps_pushdown', 'Triceps Pushdown', 30, 90, 2.5),
    ],
    createdAtMillis: nowMillis,
    updatedAtMillis: nowMillis,
  };
}

// Seeding happens exactly once per database, not once per empty table: a user who
// deletes their last routine must not find it resurrected on the next launch.
export async function ensureSeedRoutine(nowMillis: number): Promise<void> {
  await db.transaction('rw', db.routines, db.meta, async () => {
    if ((await db.meta.get('seeded')) != null) return;
    if ((await db.routines.count()) === 0) await db.routines.add(seedRoutine(nowMillis));
    await db.meta.put({ key: 'seeded', atMillis: nowMillis });
  });
}

export async function listRoutines(): Promise<RoutineRecord[]> {
  return db.routines.orderBy('createdAtMillis').toArray();
}

export async function getRoutine(id: string): Promise<RoutineRecord | undefined> {
  return db.routines.get(id);
}

export async function putRoutine(routine: RoutineRecord): Promise<void> {
  await db.routines.put(routine);
}

export async function deleteRoutine(id: string): Promise<void> {
  await db.routines.delete(id);
}

export async function duplicateRoutine(id: string, nowMillis: number): Promise<string | null> {
  const original = await db.routines.get(id);
  if (original == null) return null;
  const copy: RoutineRecord = {
    ...original,
    id: `rtn_${ulidFactory.next(nowMillis)}`,
    name: `${original.name} (copy)`,
    createdAtMillis: nowMillis,
    updatedAtMillis: nowMillis,
  };
  await db.routines.add(copy);
  return copy.id;
}

export function newRoutine(nowMillis: number): RoutineRecord {
  return {
    id: `rtn_${ulidFactory.next(nowMillis)}`,
    name: 'New routine',
    slots: [],
    createdAtMillis: nowMillis,
    updatedAtMillis: nowMillis,
  };
}

export function slotFromDefinition(definition: ExerciseDefinition): RoutineSlotRecord {
  return {
    exerciseDefinitionId: definition.id,
    name: definition.name,
    comparisonSignature: comparisonSignature(definition, null),
    sets: 4,
    targetLoadKg: null,
    targetRepMin: 8,
    targetRepMax: 12,
    targetRirMin: 1,
    targetRirMax: 3,
    incrementKg: definition.defaultIncrementKg ?? 2.5,
    restSeconds: definition.defaultRestSeconds,
  };
}

export async function saveSessionPlan(plan: SessionPlanRecord): Promise<void> {
  await db.sessionPlans.put(plan);
}

export async function loadSessionPlan(sessionId: string): Promise<SessionPlanRecord | undefined> {
  return db.sessionPlans.get(sessionId);
}

// Resolves to [] when the session has no plan, so a live query can tell
// "no plan" apart from "still loading" (undefined).
export async function loadSessionPlanSlots(sessionId: string): Promise<RoutineSlotRecord[]> {
  return (await db.sessionPlans.get(sessionId))?.slots ?? [];
}
