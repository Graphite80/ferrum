import { Dexie, type EntityTable } from 'dexie';
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
  comparisonSignature: string;
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

export interface SettingsRecord {
  key: 'settings';
  unit: WeightUnit;
}

export interface MetaRecord {
  key: 'seeded';
  atMillis: number;
}

export class FerrumDb extends Dexie {
  events!: EntityTable<StoredEvent, 'eventId'>;
  snapshots!: EntityTable<SessionSnapshot, 'sessionId'>;
  device!: EntityTable<DeviceRecord, 'key'>;
  restTimers!: EntityTable<RestTimerRecord, 'sessionId'>;
  routines!: EntityTable<RoutineRecord, 'id'>;
  sessionPlans!: EntityTable<SessionPlanRecord, 'sessionId'>;
  settings!: EntityTable<SettingsRecord, 'key'>;
  meta!: EntityTable<MetaRecord, 'key'>;

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
