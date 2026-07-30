import { localDate, type LocalDate, type SetType } from '@ferrum/domain';
import { stableId } from '../ids.ts';
import {
  UnsupportedExportFormat,
  type ImportAmbiguity,
  type NormalizedSetRow,
  type SourceExtraction,
  type UnresolvedRow,
} from '../model.ts';

export { classifySetType, DEFAULT_WARMUP_POLICY } from '../warmup.ts';

export const LIFE_AS_CODE_FORMAT_ID = 'life-as-code:get_strength_sets';

export interface LifeAsCodeSetRow {
  readonly id: number | string;
  readonly date: string;
  readonly exercise: string;
  readonly set_index: number;
  readonly weight_kg: number | null;
  readonly reps: number | null;
  readonly rpe: number | null;
  readonly rest_s: number | null;
  // Optional: older exports of this format predate both columns, and a reader
  // that demanded them would reject every one of those documents outright.
  readonly duration_seconds?: number | null;
  readonly distance_meters?: number | null;
  readonly set_type: string;
}

// Every row in this export says "normal", including the openers that are obviously
// warmups, so that value carries no information and is discarded rather than trusted.
// A value the source went out of its way to write is genuine and is kept.
const UNINFORMATIVE_SET_TYPE = 'normal';

const SET_TYPES: Readonly<Record<string, SetType>> = {
  warmup: 'warmup',
  drop: 'drop',
  dropset: 'drop',
  failure: 'amrap',
  amrap: 'amrap',
  technique: 'technique',
  top: 'top',
  backoff: 'backoff',
};

const ASSUMPTIONS: readonly string[] = [
  'The export is a flat list of sets with no session boundaries, so every set logged on the same calendar day is treated as one workout.',
  'Warmups are not flagged in this export: every row arrives as "normal". Leading sets that are far below the day\'s top load for the same exercise are reclassified as warmup by the import heuristic, each one flagged so it can be restored to a working set.',
  'RPE is converted to RIR as 10 - RPE. Rows without an RPE keep a null RIR; no effort figure is invented.',
  'A rest duration is never present in this export, so no rest time is recorded.',
  'A row carrying a duration or a distance instead of reps is a timed hold or a cardio effort, and is imported as such rather than discarded.',
];

export function extractLifeAsCode(document: unknown): SourceExtraction {
  const sets = readSets(document);
  const rows: NormalizedSetRow[] = [];
  const rejected: UnresolvedRow[] = [];
  const ambiguities: ImportAmbiguity[] = [];

  sets.forEach((entry, position) => {
    const record = entry as Partial<LifeAsCodeSetRow> | null;
    const sourceRecordId = record?.id == null ? `row-${position + 1}` : String(record.id);

    if (record == null || typeof record !== 'object') {
      rejected.push({
        sourceRecordId,
        reason: 'invalid_row',
        detail: 'the entry is not an object',
        originalPayload: entry,
      });
      return;
    }

    const day = parseDay(record.date);
    if (day == null) {
      rejected.push({
        sourceRecordId,
        reason: 'unparsable_field',
        detail: `date "${String(record.date)}" is not an ISO calendar day`,
        originalPayload: entry,
      });
      return;
    }

    const exercise = typeof record.exercise === 'string' ? record.exercise.trim() : '';
    if (exercise === '') {
      rejected.push({
        sourceRecordId,
        reason: 'invalid_row',
        detail: 'the exercise name is missing',
        originalPayload: entry,
      });
      return;
    }

    const weight = numberOrNull(record.weight_kg);
    const declaredSetType = (
      typeof record.set_type === 'string' ? record.set_type : UNINFORMATIVE_SET_TYPE
    )
      .trim()
      .toLowerCase();

    rows.push({
      sourceRecordId,
      sessionKey: day,
      sessionTitle: null,
      sessionNote: null,
      localDate: day,
      startedAt: null,
      tzOffsetMinutes: null,
      sessionDurationSeconds: null,
      rawExerciseName: exercise,
      setOrder: numberOrNull(record.set_index) ?? position,
      declaredSetType:
        declaredSetType === UNINFORMATIVE_SET_TYPE ? null : (SET_TYPES[declaredSetType] ?? null),
      enteredLoad: weight,
      enteredUnit: weight == null ? null : 'kg',
      loadKind: weight == null ? 'bodyweight_only' : 'external',
      reps: numberOrNull(record.reps),
      rpe: numberOrNull(record.rpe),
      // A timed hold and a cardio effort are sets like any other. Discarding
      // these two fields dropped every plank, side plank and spin from the
      // import as "describes no set", which is the source recording something
      // and this reader refusing to see it.
      durationSeconds: numberOrNull(record.duration_seconds),
      distanceMeters: numberOrNull(record.distance_meters),
      restSeconds: numberOrNull(record.rest_s),
      note: null,
      supersetKey: null,
      originalPayload: entry,
    });
  });

  if (sets.length > 0) {
    ambiguities.push({
      kind: 'session_boundaries_inferred',
      detail:
        'Sessions were reconstructed from calendar dates. Two workouts on the same day arrive as one session and have to be split by hand.',
      sourceRecordIds: [],
      choices: ['keep_as_one_session', 'split_by_hand'],
    });
  }

  return {
    source: 'life-as-code',
    formatId: LIFE_AS_CODE_FORMAT_ID,
    rows,
    rejected,
    warmupDetection: 'heuristic',
    assumptions: ASSUMPTIONS,
    ambiguities,
  };
}

export function lifeAsCodeRecordId(row: LifeAsCodeSetRow): string {
  return String(row.id);
}

export function lifeAsCodeBatchId(document: unknown, capturedAtFallback: string): string {
  const captured =
    isRecord(document) && typeof document['captured_at'] === 'string'
      ? document['captured_at']
      : capturedAtFallback;
  return stableId('imp', 'life-as-code', captured);
}

function readSets(document: unknown): readonly unknown[] {
  if (Array.isArray(document)) return document;
  if (isRecord(document) && Array.isArray(document['sets'])) return document['sets'];
  throw new UnsupportedExportFormat(
    'life-as-code',
    'expected a { sets: [...] } document or a bare array of sets'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseDay(value: unknown): LocalDate | null {
  if (typeof value !== 'string') return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return localDate(day);
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
