import { db, type RestTimerRecord } from '../db/ferrum-db.ts';

export interface RestTimerView {
  readonly durationSeconds: number;
  readonly remainingSeconds: number;
  readonly overdueSeconds: number;
  readonly finished: boolean;
}

// Past this, the banner is not reporting a rest — it is reporting that a workout
// was walked away from. Resuming a session left overnight used to show "Rest
// finished +8459:47", a number that is both meaningless and, since formatClock
// carries no hours, unreadable as the six days it actually was.
export const REST_ABANDONED_AFTER_SECONDS = 3_600;

// The display is always derived from endsAt minus now. setInterval is a repaint
// trigger and never the source of truth: a throttled or suspended tab stops firing
// it, and a timer that counted ticks would come back from the background minutes
// wrong while looking perfectly plausible.
export function viewTimer(record: RestTimerRecord, nowMillis: number): RestTimerView | null {
  const remainingMillis = record.endsAtMillis - nowMillis;
  const overdueSeconds = remainingMillis >= 0 ? 0 : Math.floor(-remainingMillis / 1000);
  if (overdueSeconds > REST_ABANDONED_AFTER_SECONDS) return null;
  return {
    durationSeconds: record.durationSeconds,
    remainingSeconds: Math.max(0, Math.ceil(remainingMillis / 1000)),
    overdueSeconds,
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
