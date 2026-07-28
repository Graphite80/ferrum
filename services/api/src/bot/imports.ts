import { randomUUID } from 'node:crypto';
import { type DeviceId, type UserId } from '@ferrum/domain';
import {
  runImport,
  type ExerciseResolver,
  type ImportResult,
  type SourceExtraction,
} from '@ferrum/importers';
import { type Database } from '../db.ts';
import { loadUserEvents, pushBatch } from '../sync.ts';
import { existingHistoryOf } from './history.ts';

export const BOT_DEVICE_ID = 'tg-import' as DeviceId;

export interface BotImportOutcome {
  readonly result: ImportResult;
  readonly accepted: number;
  readonly duplicates: number;
}

export async function importForUser(
  db: Database,
  userId: string,
  extraction: SourceExtraction,
  resolver: ExerciseResolver
): Promise<BotImportOutcome> {
  const priorEvents = await loadUserEvents(db, userId);
  const result = runImport(extraction, {
    importBatchId: `tg-${randomUUID()}`,
    userId: userId as UserId,
    deviceId: BOT_DEVICE_ID,
    resolver,
    existing: existingHistoryOf(priorEvents),
  });

  if (result.events.length === 0) return { result, accepted: 0, duplicates: 0 };

  const pushed = await db.transaction(tx =>
    pushBatch(tx, userId, { deviceId: BOT_DEVICE_ID, events: result.events }, Date.now())
  );
  return { result, accepted: pushed.accepted, duplicates: pushed.duplicates };
}
