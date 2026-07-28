import { db, type RestTimerRecord } from '../db/ferrum-db.ts';

export interface RestTimerView {
  readonly durationSeconds: number;
  readonly remainingSeconds: number;
  readonly overdueSeconds: number;
  readonly finished: boolean;
}

// The display is always derived from endsAt minus now. setInterval is a repaint
// trigger and never the source of truth: a throttled or suspended tab stops firing
// it, and a timer that counted ticks would come back from the background minutes
// wrong while looking perfectly plausible.
export function viewTimer(record: RestTimerRecord, nowMillis: number): RestTimerView {
  const remainingMillis = record.endsAtMillis - nowMillis;
  return {
    durationSeconds: record.durationSeconds,
    remainingSeconds: Math.max(0, Math.ceil(remainingMillis / 1000)),
    overdueSeconds: remainingMillis >= 0 ? 0 : Math.floor(-remainingMillis / 1000),
    finished: remainingMillis <= 0,
  };
}

export function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes)}:${rest.toString().padStart(2, '0')}`;
}

export async function startRestTimer(
  sessionId: string,
  durationSeconds: number,
  nowMillis: number
): Promise<RestTimerRecord> {
  const record: RestTimerRecord = {
    sessionId,
    startedAtMillis: nowMillis,
    endsAtMillis: nowMillis + durationSeconds * 1000,
    durationSeconds,
    status: 'running',
  };
  await db.restTimers.put(record);
  return record;
}

export async function dismissRestTimer(sessionId: string): Promise<void> {
  await db.restTimers.where('sessionId').equals(sessionId).modify({ status: 'dismissed' });
}

export async function loadRestTimer(sessionId: string): Promise<RestTimerRecord | null> {
  const record = await db.restTimers.get(sessionId);
  return record?.status === 'running' ? record : null;
}
