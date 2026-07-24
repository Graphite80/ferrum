import type { Instant, LocalDate, SetType, WeightUnit, WorkoutSetId } from '@ferrum/domain';

export type ImportSourceId = 'life-as-code' | 'hevy' | 'strong';

export type LoadKind = 'external' | 'assistance' | 'bodyweight_only';

export type WarmupDetectionMode = 'trust_source' | 'heuristic';

export interface NormalizedSetRow {
  readonly sourceRecordId: string;
  readonly sessionKey: string;
  readonly sessionTitle: string | null;
  readonly sessionNote: string | null;
  readonly localDate: LocalDate;
  readonly startedAt: Instant | null;
  readonly tzOffsetMinutes: number | null;
  readonly sessionDurationSeconds: number | null;
  readonly rawExerciseName: string;
  readonly setOrder: number;
  readonly declaredSetType: SetType | null;
  readonly enteredLoad: number | null;
  readonly enteredUnit: WeightUnit | null;
  readonly loadKind: LoadKind;
  readonly reps: number | null;
  readonly rpe: number | null;
  readonly durationSeconds: number | null;
  readonly distanceMeters: number | null;
  readonly restSeconds: number | null;
  readonly note: string | null;
  readonly supersetKey: string | null;
  readonly originalPayload: unknown;
}

export type UnresolvedReason =
  | 'invalid_row'
  | 'unparsable_field'
  | 'unmatched_exercise'
  | 'duplicate_source_record'
  | 'non_set_row';

export interface UnresolvedRow {
  readonly sourceRecordId: string;
  readonly reason: UnresolvedReason;
  readonly detail: string;
  readonly originalPayload: unknown;
}

export type AmbiguityKind =
  | 'weight_unit_unknown'
  | 'entered_load_is_zero'
  | 'assistance_is_not_load'
  | 'rpe_out_of_range'
  | 'session_boundaries_inferred'
  | 'set_type_inferred'
  | 'load_entry_mode_unknown'
  | 'likely_duplicate_session';

export interface ImportAmbiguity {
  readonly kind: AmbiguityKind;
  readonly detail: string;
  readonly sourceRecordIds: readonly string[];
  readonly choices: readonly string[];
}

export interface SetProvenance {
  readonly setId: WorkoutSetId;
  readonly source: ImportSourceId;
  readonly sourceRecordId: string;
  readonly importBatchId: string;
  readonly originalPayload: unknown;
  readonly setTypeReclassified: boolean;
  readonly setTypeReclassificationReason: string | null;
  readonly canonicalLoadWithheld: boolean;
}

export interface SourceExtraction {
  readonly source: ImportSourceId;
  readonly formatId: string;
  readonly rows: readonly NormalizedSetRow[];
  readonly rejected: readonly UnresolvedRow[];
  readonly warmupDetection: WarmupDetectionMode;
  readonly assumptions: readonly string[];
  readonly ambiguities: readonly ImportAmbiguity[];
}

export class UnsupportedExportFormat extends Error {
  constructor(
    readonly source: ImportSourceId,
    readonly detail: string
  ) {
    super(`Cannot import this ${source} export: ${detail}`);
    this.name = 'UnsupportedExportFormat';
  }
}
