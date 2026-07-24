import Dexie, { type EntityTable } from 'dexie';
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
    super(name);
    this.version(1).stores({
      events: '&eventId, aggregateId, orderKey, acknowledged, [aggregateId+orderKey]',
      snapshots: '&sessionId, updatedAtMillis',
      device: '&key',
      restTimers: '&sessionId',
    });
  }
}

export const db = new FerrumDb();
