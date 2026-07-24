import {
  type SessionExerciseId,
  type SessionId,
  type SetMeasurements,
  type SetQualifiers,
  type WorkoutSetId,
  instant,
  kilograms,
  toLocalDate,
} from '@ferrum/domain';
import { appendEvents, type AppendInput } from '../../db/event-store.ts';
import { ulidFactory } from '../../platform/ids.ts';
import { type Routine, type RoutineSlot } from './routine.ts';

export interface LoggedSetInput {
  readonly sessionId: SessionId;
  readonly sessionExerciseId: SessionExerciseId;
  readonly slot: RoutineSlot;
  readonly orderIndex: number;
  readonly loadKg: number;
  readonly reps: number;
  readonly rir: number;
}

function tzOffsetMinutes(nowMillis: number): number {
  return -new Date(nowMillis).getTimezoneOffset();
}

export function sessionExerciseIdFor(sessionId: SessionId, slotIndex: number): SessionExerciseId {
  return `${sessionId}:ex${String(slotIndex)}` as SessionExerciseId;
}

export async function startSession(routine: Routine, nowMillis: number): Promise<SessionId> {
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
        title: routine.name,
      },
    },
    ...routine.slots.map<AppendInput>((routineSlot, index) => ({
      aggregateId: sessionId,
      eventType: 'ExerciseAddedToSession',
      payload: {
        sessionExerciseId: sessionExerciseIdFor(sessionId, index),
        sessionId,
        exerciseDefinitionId: routineSlot.exerciseDefinitionId,
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

export async function logSet(input: LoggedSetInput, nowMillis: number): Promise<WorkoutSetId> {
  const setId = `set_${ulidFactory.next(nowMillis)}` as WorkoutSetId;
  const offset = tzOffsetMinutes(nowMillis);

  const measurements: SetMeasurements = {
    enteredLoad: input.loadKg,
    enteredUnit: 'kg',
    canonicalExternalLoadKg: kilograms(input.loadKg),
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
          prescriptionSnapshot: {
            prescriptionVersion: 1,
            setType: 'working',
            targetLoadKg: input.slot.targetLoadKg,
            targetRepMin: input.slot.targetRepMin,
            targetRepMax: input.slot.targetRepMax,
            targetRir: input.slot.targetRir,
            targetRpe: null,
            ruleId: null,
            ruleVersion: null,
            explanationContext: 'seed routine',
          },
          exerciseRevisionSnapshot: 1,
          comparisonSignature: input.slot.comparisonSignature,
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
