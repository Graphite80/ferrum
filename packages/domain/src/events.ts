import { type ComparisonSignature } from './comparison.ts';
import { type EquipmentInstanceId } from './equipment.ts';
import { type ExerciseDefinitionId } from './exercise.ts';
import { type BodyweightSource } from './bodyweight.ts';
import { compareHlc, encodeHlc, type Hlc } from './hlc.ts';
import { type SetPrescriptionSnapshot, type SetType } from './prescription.ts';
import {
  type DeviceId,
  type SessionExerciseId,
  type SessionId,
  type SetMeasurements,
  type SetQualifiers,
  type SupersetGroupId,
  type SupersetRestMode,
  type WorkoutSetId,
} from './set.ts';
import { type Instant, type LocalDate } from './time.ts';
import { type Kilograms } from './units.ts';

export type EventId = string & { readonly __brand: 'EventId' };
export type UserId = string & { readonly __brand: 'UserId' };

export const EVENT_SCHEMA_VERSION = 1;

export interface SessionStartedPayload {
  readonly sessionId: SessionId;
  readonly startedAt: Instant;
  readonly localDate: LocalDate;
  readonly tzOffsetMinutes: number;
  readonly title: string | null;
}

export interface SessionMetadataChangedPayload {
  readonly sessionId: SessionId;
  readonly title?: string | null;
  readonly note?: string | null;
}

export interface ExerciseAddedToSessionPayload {
  readonly sessionExerciseId: SessionExerciseId;
  readonly sessionId: SessionId;
  readonly exerciseDefinitionId: ExerciseDefinitionId;
  readonly equipmentInstanceId: EquipmentInstanceId | null;
  readonly orderIndex: number;
  readonly supersetGroupId: SupersetGroupId | null;
  readonly supersetOrder: number | null;
}

export interface ExerciseRemovedFromSessionPayload {
  readonly sessionExerciseId: SessionExerciseId;
}

export interface ExerciseReorderedPayload {
  readonly sessionId: SessionId;
  readonly orderedSessionExerciseIds: readonly SessionExerciseId[];
}

export interface ExerciseSubstitutedPayload {
  readonly sessionExerciseId: SessionExerciseId;
  readonly toExerciseDefinitionId: ExerciseDefinitionId;
  readonly equipmentInstanceId: EquipmentInstanceId | null;
}

export interface SupersetGroupChangedPayload {
  readonly sessionId: SessionId;
  readonly groupId: SupersetGroupId;
  readonly restMode: SupersetRestMode;
  readonly restSecondsIntra: number;
  readonly restSecondsInter: number;
  readonly memberSessionExerciseIds: readonly SessionExerciseId[];
}

export interface SetLoggedPayload {
  readonly setId: WorkoutSetId;
  readonly sessionExerciseId: SessionExerciseId;
  readonly orderIndex: number;
  readonly setType: SetType;
  readonly measurements: SetMeasurements;
  readonly qualifiers: SetQualifiers;
  readonly equipmentInstanceId: EquipmentInstanceId | null;
  readonly bodyweightKgSnapshot: Kilograms | null;
  readonly bodyweightSource: BodyweightSource | null;
  readonly bodyweightAgeDays: number | null;
  readonly prescriptionSnapshot: SetPrescriptionSnapshot | null;
  readonly exerciseRevisionSnapshot: number;
  readonly comparisonSignature: ComparisonSignature;
  readonly performedAt: Instant | null;
  readonly localDate: LocalDate;
  readonly tzOffsetMinutes: number;
}

export interface SetAmendedPayload {
  readonly setId: WorkoutSetId;
  readonly setType?: SetType;
  readonly measurements?: Partial<SetMeasurements>;
  readonly qualifiers?: Partial<SetQualifiers>;
  readonly equipmentInstanceId?: EquipmentInstanceId | null;
  readonly comparisonSignature?: ComparisonSignature;
}

export interface SetDeletedPayload {
  readonly setId: WorkoutSetId;
}

export interface SetRestoredPayload {
  readonly setId: WorkoutSetId;
}

export interface SessionFinishedPayload {
  readonly sessionId: SessionId;
  readonly finishedAt: Instant;
}

export interface SessionReopenedPayload {
  readonly sessionId: SessionId;
}

export type DomainEventPayloadMap = {
  SessionStarted: SessionStartedPayload;
  SessionMetadataChanged: SessionMetadataChangedPayload;
  ExerciseAddedToSession: ExerciseAddedToSessionPayload;
  ExerciseRemovedFromSession: ExerciseRemovedFromSessionPayload;
  ExerciseReordered: ExerciseReorderedPayload;
  ExerciseSubstituted: ExerciseSubstitutedPayload;
  SupersetGroupChanged: SupersetGroupChangedPayload;
  SetLogged: SetLoggedPayload;
  SetAmended: SetAmendedPayload;
  SetDeleted: SetDeletedPayload;
  SetRestored: SetRestoredPayload;
  SessionFinished: SessionFinishedPayload;
  SessionReopened: SessionReopenedPayload;
};

export type DomainEventType = keyof DomainEventPayloadMap;

export interface EventEnvelope<T extends DomainEventType = DomainEventType> {
  readonly eventId: EventId;
  readonly aggregateId: SessionId;
  readonly userId: UserId | null;
  readonly deviceId: DeviceId;
  readonly eventType: T;
  readonly schemaVersion: number;
  readonly hlc: Hlc;
  readonly payload: DomainEventPayloadMap[T];
  readonly clientCreatedAt: Instant;
  readonly serverReceivedAt: Instant | null;
  readonly serverSequence: number | null;
}

export type DomainEvent = { [T in DomainEventType]: EventEnvelope<T> }[DomainEventType];

// Total order across devices. HLC alone can tie when two devices produce events in
// the same logical instant; eventId breaks the tie so that every replica reaches an
// identical projection from an identical set of events, regardless of arrival order.
export function compareEvents(a: DomainEvent, b: DomainEvent): number {
  const byClock = compareHlc(a.hlc, b.hlc);
  if (byClock !== 0) return byClock;
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

export function sortEvents(events: readonly DomainEvent[]): DomainEvent[] {
  return [...events].sort(compareEvents);
}

export function dedupeEvents(events: readonly DomainEvent[]): DomainEvent[] {
  const seen = new Map<EventId, DomainEvent>();
  for (const event of events) {
    if (!seen.has(event.eventId)) seen.set(event.eventId, event);
  }
  return [...seen.values()];
}

export function eventOrderKey(event: DomainEvent): string {
  return `${encodeHlc(event.hlc)}#${event.eventId}`;
}
