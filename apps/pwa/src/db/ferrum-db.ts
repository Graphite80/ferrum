import { Dexie, type EntityTable } from 'dexie';
import { type DomainEvent } from '@ferrum/domain';

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

export class FerrumDb extends Dexie {
  events!: EntityTable<StoredEvent, 'eventId'>;
  snapshots!: EntityTable<SessionSnapshot, 'sessionId'>;
  device!: EntityTable<DeviceRecord, 'key'>;
  restTimers!: EntityTable<RestTimerRecord, 'sessionId'>;

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
