import { Dexie, type EntityTable, type Table } from 'dexie';
import { type DomainEvent, type WeightUnit } from '@ferrum/domain';

export interface StoredEvent {
  eventId: string;
  aggregateId: string;
  orderKey: string;
  acknowledged: 0 | 1;
  envelope: DomainEvent;
}

export interface SessionSnapshot {
  sessionId: string;
  updatedAtMillis: number;
  upToOrderKey: string;
  payload: unknown;
}

// A local tombstone for a session the user destroyed. It outlives the events it
// replaces: without it, the very next pull re-imports the workout from the server
// and the "delete forever" the user asked for lasts until the next sync.
export interface PurgeRecord {
  aggregateId: string;
  requestedAtMillis: number;
  pushed: 0 | 1;
}

export interface DeviceRecord {
  key: 'device';
  deviceId: string;
  hlcWallMillis: number;
  hlcCounter: number;
}

export interface RestTimerRecord {
  sessionId: string;
  startedAtMillis: number;
  endsAtMillis: number;
  durationSeconds: number;
  status: 'running' | 'dismissed';
}

export interface RoutineSlotRecord {
  exerciseDefinitionId: string;
  name: string;
  // Absent means "ask the library". A routine built from a picked exercise
  // stores the signature the library computed; one that cannot see the library
  // must leave it out rather than assemble a plausible-looking string, because
  // a wrong signature is not a cosmetic error — it is the key history is looked
  // up by, so it silently answers "no previous set" forever.
  comparisonSignature?: string;
  sets: number;
  targetLoadKg: number | null;
  targetRepMin: number;
  targetRepMax: number;
  targetRirMin: number;
  targetRirMax: number;
  incrementKg: number;
  restSeconds: number;
}

export interface RoutineRecord {
  id: string;
  name: string;
  slots: RoutineSlotRecord[];
  createdAtMillis: number;
  updatedAtMillis: number;
}

// The routine as it was when the session started. Editing a routine later must
// never change what an already-running or past session was asked to do, so the
// workout screen reads this snapshot, mirroring the prescription-snapshot rule.
export interface SessionPlanRecord {
  sessionId: string;
  routineId: string;
  routineName: string;
  slots: RoutineSlotRecord[];
}

// One physical machine. It carries the gym in its name rather than in a separate gym
// entity: what the comparison signature needs is a stable identity per machine, and a
// second table of gyms would add a screen without adding a fact.
export interface EquipmentRecord {
  id: string;
  exerciseDefinitionId: string;
  name: string;
  manufacturer: string | null;
  stackIncrementKg: number | null;
  lastUsedAtMillis: number;
}

export type SettingsRecord =
  | { key: 'settings'; unit: WeightUnit }
  // Records written before the server field was dropped still carry it; nothing
  // reads it, and Dexie does not index it, so they need no migration.
  | { key: 'syncConfig'; syncToken: string | null };

export type MetaRecord =
  | { key: 'seeded'; atMillis: number }
  | {
      key: 'syncState';
      cursor: number;
      // Absent on records written before the purge journal existed.
      purgeCursor?: number;
      lastSuccessAtMillis: number | null;
      driftMessage: string | null;
    };

export class FerrumDb extends Dexie {
  events!: EntityTable<StoredEvent, 'eventId'>;
  snapshots!: EntityTable<SessionSnapshot, 'sessionId'>;
  device!: EntityTable<DeviceRecord, 'key'>;
  restTimers!: EntityTable<RestTimerRecord, 'sessionId'>;
  routines!: EntityTable<RoutineRecord, 'id'>;
  sessionPlans!: EntityTable<SessionPlanRecord, 'sessionId'>;
  purges!: EntityTable<PurgeRecord, 'aggregateId'>;
  equipment!: EntityTable<EquipmentRecord, 'id'>;
  // Table rather than EntityTable: EntityTable's InsertType collapses a
  // discriminated union to its common keys, rejecting every variant's own fields.
  settings!: Table<SettingsRecord, SettingsRecord['key'], SettingsRecord>;
  meta!: Table<MetaRecord, MetaRecord['key'], MetaRecord>;

  constructor(name = 'ferrum') {
    // Relaxed durability lets the browser acknowledge a transaction before it
    // reaches disk, trading a power-loss window for 3-30x throughput. A workout
    // writes roughly forty small events, so strict costs milliseconds we have and
    // removes one of the few loss modes that server sync cannot repair.
    super(name, { chromeTransactionDurability: 'strict' });
    this.version(1).stores({
      events: '&eventId, aggregateId, orderKey, acknowledged, [aggregateId+orderKey]',
      snapshots: '&sessionId, updatedAtMillis',
      device: '&key',
      restTimers: '&sessionId',
    });
    this.version(2).stores({
      routines: '&id, createdAtMillis',
      sessionPlans: '&sessionId',
      settings: '&key',
      meta: '&key',
    });
    this.version(3).stores({
      events:
        '&eventId, aggregateId, orderKey, acknowledged, [aggregateId+orderKey], [acknowledged+orderKey]',
    });
    this.version(4).stores({
      purges: '&aggregateId, pushed',
    });
    this.version(5).stores({
      equipment: '&id, exerciseDefinitionId',
    });
  }
}

export const db = new FerrumDb();

// On iOS a hard IndexedDB failure is a when, not an if: WebKit throws UnknownError
// on wake-from-background and DatabaseClosedError after the connection is dropped.
// Treating either as fatal would strand an in-progress workout, so the database is
// reopened and the caller retried once.
export async function withDatabaseRecovery<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isRecoverableDatabaseError(error)) throw error;
    db.close();
    await db.open();
    return operation();
  }
}

function isRecoverableDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'DatabaseClosedError' ||
    error.name === 'UnknownError' ||
    error.name === 'InvalidStateError'
  );
}
