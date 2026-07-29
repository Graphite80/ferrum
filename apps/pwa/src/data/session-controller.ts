import {
  type ComparisonSignature,
  type ExerciseDefinitionId,
  type SessionExerciseId,
  type SessionId,
  type SetMeasurements,
  type SetPrescriptionSnapshot,
  type SetQualifiers,
  type WeightUnit,
  type WorkoutSetId,
  instant,
  toKilograms,
  toLocalDate,
} from '@ferrum/domain';
import { appendEvents, type AppendInput } from '../db/event-store.ts';
import { type RoutineRecord } from '../db/ferrum-db.ts';
import { saveSessionPlan } from './routine-store.ts';
import { ulidFactory } from '../platform/ids.ts';

export interface LoggedSetInput {
  readonly sessionId: SessionId;
  readonly sessionExerciseId: SessionExerciseId;
  readonly orderIndex: number;
  readonly enteredLoad: number;
  readonly unit: WeightUnit;
  readonly reps: number;
  readonly rir: number;
  readonly comparisonSignature: ComparisonSignature;
  readonly prescription: SetPrescriptionSnapshot | null;
}

export interface SetPatch {
  load?: { entered: number; unit: WeightUnit };
  reps?: number;
  rir?: number;
}

function tzOffsetMinutes(nowMillis: number): number {
  return -new Date(nowMillis).getTimezoneOffset();
}

function mintSessionExerciseId(sessionId: SessionId, nowMillis: number): SessionExerciseId {
  return `${sessionId}:ex_${ulidFactory.next(nowMillis)}` as SessionExerciseId;
}

async function beginSession(
  title: string | null,
  definitionIds: readonly string[],
  nowMillis: number
): Promise<SessionId> {
  const sessionId = `ses_${ulidFactory.next(nowMillis)}` as SessionId;
  const offset = tzOffsetMinutes(nowMillis);
  const localDate = toLocalDate({ instant: instant(nowMillis), tzOffsetMinutes: offset });

  const inputs: AppendInput[] = [
    {
      aggregateId: sessionId,
      eventType: 'SessionStarted',
      payload: {
        sessionId,
        startedAt: instant(nowMillis),
        localDate,
        tzOffsetMinutes: offset,
        title,
      },
    },
    ...definitionIds.map<AppendInput>((definitionId, index) => ({
      aggregateId: sessionId,
      eventType: 'ExerciseAddedToSession',
      payload: {
        sessionExerciseId: mintSessionExerciseId(sessionId, nowMillis),
        sessionId,
        exerciseDefinitionId: definitionId as ExerciseDefinitionId,
        equipmentInstanceId: null,
        orderIndex: index,
        supersetGroupId: null,
        supersetOrder: null,
      },
    })),
  ];

  await appendEvents(inputs, nowMillis);
  return sessionId;
}

export async function startSession(routine: RoutineRecord, nowMillis: number): Promise<SessionId> {
  const sessionId = await beginSession(
    routine.name,
    routine.slots.map(slot => slot.exerciseDefinitionId),
    nowMillis
  );
  // A separate short write on purpose: the append transaction stays exactly one
  // transaction wide, and a lost plan snapshot only costs prefilled targets.
  await saveSessionPlan({
    sessionId,
    routineId: routine.id,
    routineName: routine.name,
    slots: routine.slots.map(slot => ({ ...slot })),
  });
  return sessionId;
}

export async function startEmptySession(nowMillis: number): Promise<SessionId> {
  return beginSession(null, [], nowMillis);
}

export async function addExercise(
  sessionId: SessionId,
  exerciseDefinitionId: ExerciseDefinitionId,
  orderIndex: number,
  nowMillis: number
): Promise<SessionExerciseId> {
  const sessionExerciseId = mintSessionExerciseId(sessionId, nowMillis);
  await appendEvents(
    [
      {
        aggregateId: sessionId,
        eventType: 'ExerciseAddedToSession',
        payload: {
          sessionExerciseId,
          sessionId,
          exerciseDefinitionId,
          equipmentInstanceId: null,
          orderIndex,
          supersetGroupId: null,
          supersetOrder: null,
        },
      },
    ],
    nowMillis
  );
  return sessionExerciseId;
}

export async function removeExercise(
  sessionId: SessionId,
  sessionExerciseId: SessionExerciseId,
  nowMillis: number
): Promise<void> {
  await appendEvents(
    [
      {
        aggregateId: sessionId,
        eventType: 'ExerciseRemovedFromSession',
        payload: { sessionExerciseId },
      },
    ],
    nowMillis
  );
}

export async function logSet(input: LoggedSetInput, nowMillis: number): Promise<WorkoutSetId> {
  const setId = `set_${ulidFactory.next(nowMillis)}` as WorkoutSetId;
  const offset = tzOffsetMinutes(nowMillis);

  const measurements: SetMeasurements = {
    enteredLoad: input.enteredLoad,
    enteredUnit: input.unit,
    canonicalExternalLoadKg: toKilograms(input.enteredLoad, input.unit),
    reps: input.reps,
    durationSeconds: null,
    distanceMeters: null,
    rirEntered: input.rir,
    rpeEntered: null,
    actualRestSeconds: null,
  };

  const qualifiers: SetQualifiers = {
    tempo: null,
    rangeOfMotionNote: null,
    painFlag: 0,
    formFlag: false,
    note: null,
  };

  await appendEvents(
    [
      {
        aggregateId: input.sessionId,
        eventType: 'SetLogged',
        payload: {
          setId,
          sessionExerciseId: input.sessionExerciseId,
          orderIndex: input.orderIndex,
          setType: 'working',
          measurements,
          qualifiers,
          equipmentInstanceId: null,
          bodyweightKgSnapshot: null,
          bodyweightSource: null,
          bodyweightAgeDays: null,
          prescriptionSnapshot: input.prescription,
          exerciseRevisionSnapshot: 1,
          comparisonSignature: input.comparisonSignature,
          provenance: null,
          performedAt: instant(nowMillis),
          localDate: toLocalDate({ instant: instant(nowMillis), tzOffsetMinutes: offset }),
          tzOffsetMinutes: offset,
        },
      },
    ],
    nowMillis
  );

  return setId;
}

// Only the amendable fields of INVARIANTS §5 can travel here; the payload type
// structurally cannot carry immutable ones.
export async function amendSet(
  sessionId: SessionId,
  setId: WorkoutSetId,
  patch: SetPatch,
  nowMillis: number
): Promise<void> {
  const measurements: Partial<SetMeasurements> = {
    ...(patch.load !== undefined
      ? {
          enteredLoad: patch.load.entered,
          enteredUnit: patch.load.unit,
          canonicalExternalLoadKg: toKilograms(patch.load.entered, patch.load.unit),
        }
      : {}),
    ...(patch.reps !== undefined ? { reps: patch.reps } : {}),
    ...(patch.rir !== undefined ? { rirEntered: patch.rir } : {}),
  };
  if (Object.keys(measurements).length === 0) return;

  await appendEvents(
    [{ aggregateId: sessionId, eventType: 'SetAmended', payload: { setId, measurements } }],
    nowMillis
  );
}

export async function deleteSet(
  sessionId: SessionId,
  setId: WorkoutSetId,
  nowMillis: number
): Promise<void> {
  await appendEvents(
    [{ aggregateId: sessionId, eventType: 'SetDeleted', payload: { setId } }],
    nowMillis
  );
}

export async function restoreSet(
  sessionId: SessionId,
  setId: WorkoutSetId,
  nowMillis: number
): Promise<void> {
  await appendEvents(
    [{ aggregateId: sessionId, eventType: 'SetRestored', payload: { setId } }],
    nowMillis
  );
}

export async function deleteSession(
  sessionId: SessionId,
  reason: string | null,
  nowMillis: number
): Promise<void> {
  await appendEvents(
    [{ aggregateId: sessionId, eventType: 'SessionDeleted', payload: { sessionId, reason } }],
    nowMillis
  );
}

export async function restoreSession(sessionId: SessionId, nowMillis: number): Promise<void> {
  await appendEvents(
    [{ aggregateId: sessionId, eventType: 'SessionRestored', payload: { sessionId } }],
    nowMillis
  );
}

export async function finishSession(sessionId: SessionId, nowMillis: number): Promise<void> {
  await appendEvents(
    [
      {
        aggregateId: sessionId,
        eventType: 'SessionFinished',
        payload: { sessionId, finishedAt: instant(nowMillis) },
      },
    ],
    nowMillis
  );
}
