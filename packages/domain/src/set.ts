import { type ComparisonSignature } from './comparison.ts';
import { type EquipmentInstanceId } from './equipment.ts';
import { type ExerciseDefinitionId } from './exercise.ts';
import { type BodyweightSource } from './bodyweight.ts';
import { type SetPrescriptionSnapshot, type SetType } from './prescription.ts';
import { type Instant, type LocalDate } from './time.ts';
import { type Kilograms, type WeightUnit } from './units.ts';

export type SessionId = string & { readonly __brand: 'SessionId' };
export type SessionExerciseId = string & { readonly __brand: 'SessionExerciseId' };
export type WorkoutSetId = string & { readonly __brand: 'WorkoutSetId' };
export type SupersetGroupId = string & { readonly __brand: 'SupersetGroupId' };
export type DeviceId = string & { readonly __brand: 'DeviceId' };

export type SetStatus = 'planned' | 'completed' | 'skipped' | 'deleted';

export type PainFlag = 0 | 1 | 2 | 3;

export interface SetMeasurements {
  readonly enteredLoad: number | null;
  readonly enteredUnit: WeightUnit;
  readonly canonicalExternalLoadKg: Kilograms | null;
  readonly reps: number | null;
  readonly durationSeconds: number | null;
  readonly distanceMeters: number | null;
  readonly rirEntered: number | null;
  readonly rpeEntered: number | null;
  readonly actualRestSeconds: number | null;
}

// Imported sets must carry where they came from as part of the immutable record,
// not in a lookup table beside it: a sidecar keyed by set id is a second source of
// truth that does not survive sync and drifts the first time a row is amended.
export interface SetProvenance {
  readonly source: string;
  readonly sourceRecordId: string;
  readonly importBatchId: string;
  readonly originalPayload: unknown;
}

export interface SetQualifiers {
  readonly tempo: string | null;
  readonly rangeOfMotionNote: string | null;
  readonly painFlag: PainFlag;
  readonly formFlag: boolean;
  readonly note: string | null;
}

export interface WorkoutSet {
  readonly id: WorkoutSetId;
  readonly sessionExerciseId: SessionExerciseId;
  readonly orderIndex: number;
  readonly setType: SetType;
  readonly status: SetStatus;

  readonly measurements: SetMeasurements;
  readonly qualifiers: SetQualifiers;

  readonly equipmentInstanceId: EquipmentInstanceId | null;
  readonly bodyweightKgSnapshot: Kilograms | null;
  readonly bodyweightSource: BodyweightSource | null;
  readonly bodyweightAgeDays: number | null;

  readonly prescriptionSnapshot: SetPrescriptionSnapshot | null;
  readonly exerciseRevisionSnapshot: number;
  readonly comparisonSignature: ComparisonSignature;
  readonly provenance: SetProvenance | null;

  readonly performedAt: Instant | null;
  readonly recordedAt: Instant;
  readonly localDate: LocalDate;
  readonly tzOffsetMinutes: number;
  readonly sourceDeviceId: DeviceId;
}

export type SupersetRestMode = 'between_exercises' | 'after_round_only';

export interface SupersetGroup {
  readonly id: SupersetGroupId;
  readonly sessionId: SessionId;
  readonly restMode: SupersetRestMode;
  readonly restSecondsIntra: number;
  readonly restSecondsInter: number;
}

export interface SessionExercise {
  readonly id: SessionExerciseId;
  readonly sessionId: SessionId;
  readonly exerciseDefinitionId: ExerciseDefinitionId;
  readonly equipmentInstanceId: EquipmentInstanceId | null;
  readonly orderIndex: number;
  readonly supersetGroupId: SupersetGroupId | null;
  readonly supersetOrder: number | null;
  readonly substitutedFromExerciseDefinitionId: ExerciseDefinitionId | null;
}

export type SessionStatus = 'active' | 'finished' | 'abandoned';

export interface Session {
  readonly id: SessionId;
  readonly status: SessionStatus;
  readonly startedAt: Instant;
  readonly finishedAt: Instant | null;
  readonly localDate: LocalDate;
  readonly tzOffsetMinutes: number;
  readonly title: string | null;
  readonly note: string | null;
  readonly amendedAfterFinish: boolean;
}

export function isWorkingSet(set: WorkoutSet): boolean {
  return set.status === 'completed' && set.setType !== 'warmup' && set.setType !== 'technique';
}

export function isCountedForVolume(set: WorkoutSet): boolean {
  return isWorkingSet(set) && (set.measurements.reps ?? 0) > 0;
}
