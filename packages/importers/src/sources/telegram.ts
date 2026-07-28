import { localDate } from '@ferrum/domain';
import type { NormalizedSetRow, SourceExtraction, UnresolvedRow } from '../model.ts';

export const TELEGRAM_FORMAT_ID = 'telegram:shorthand-v1';

export interface TelegramSetLine {
  readonly ordinal: number;
  readonly rawExerciseName: string;
  readonly loadKg: number;
  readonly reps: number;
  readonly rir: number | null;
}

export interface TelegramMessageCapture {
  readonly messageId: number;
  readonly chatId: number;
  readonly date: string;
  readonly tzOffsetMinutes: number;
  readonly lines: readonly TelegramSetLine[];
}

const ASSUMPTIONS: readonly string[] = [
  'Telegram shorthand carries no session boundaries, so every set logged on the same calendar day lands in one workout.',
  'Shorthand loads are read as total kilograms on the implement; per-hand and per-side figures cannot be distinguished from total.',
  'RIR is what the shorthand records; RPE is derived as 10 - RIR only where an RIR was given.',
];

export function extractTelegram(message: TelegramMessageCapture): SourceExtraction {
  const day = localDate(message.date);
  const rows: NormalizedSetRow[] = [];
  const rejected: UnresolvedRow[] = [];

  for (const line of message.lines) {
    const sourceRecordId = `msg${message.messageId}#${line.ordinal}`;
    const problem = describeInvalidLine(line);
    if (problem != null) {
      rejected.push({
        sourceRecordId,
        reason: 'invalid_row',
        detail: problem,
        originalPayload: line,
      });
      continue;
    }
    rows.push({
      sourceRecordId,
      sessionKey: day,
      sessionTitle: null,
      sessionNote: null,
      localDate: day,
      startedAt: null,
      tzOffsetMinutes: message.tzOffsetMinutes,
      sessionDurationSeconds: null,
      rawExerciseName: line.rawExerciseName,
      setOrder: line.ordinal,
      declaredSetType: null,
      enteredLoad: line.loadKg,
      enteredUnit: 'kg',
      loadKind: 'external',
      reps: line.reps,
      rpe: line.rir == null ? null : 10 - line.rir,
      durationSeconds: null,
      distanceMeters: null,
      restSeconds: null,
      note: null,
      supersetKey: null,
      originalPayload: { messageId: message.messageId, chatId: message.chatId, ...line },
    });
  }

  return {
    source: 'telegram',
    formatId: TELEGRAM_FORMAT_ID,
    rows,
    rejected,
    warmupDetection: 'heuristic',
    assumptions: ASSUMPTIONS,
    ambiguities: [],
  };
}

function describeInvalidLine(line: TelegramSetLine): string | null {
  if (!Number.isInteger(line.reps) || line.reps <= 0) {
    return `reps ${line.reps} is not a positive whole number`;
  }
  if (!Number.isFinite(line.loadKg) || line.loadKg < 0) {
    return `load ${line.loadKg} kg is not a non-negative number`;
  }
  if (line.rir != null && (line.rir < 0 || line.rir > 10)) {
    return `RIR ${line.rir} is outside 0..10`;
  }
  return null;
}
