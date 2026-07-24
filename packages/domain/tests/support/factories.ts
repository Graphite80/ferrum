import fc from 'fast-check';
import {
  type ComparisonSignature,
  type DeviceId,
  type DomainEvent,
  type DomainEventPayloadMap,
  type DomainEventType,
  type EventEnvelope,
  type EventId,
  type Hlc,
  type Instant,
  type LocalDate,
  type SessionExerciseId,
  type SessionId,
  type SetMeasurements,
  type SetQualifiers,
  type SupersetGroupId,
  type UserId,
  type WorkoutSetId,
  type ExerciseDefinitionId,
  EVENT_SCHEMA_VERSION,
  instant,
  kilograms,
  localDate,
} from '../../src/index.ts';

export const SESSION_ID = 'session-01' as SessionId;
export const USER_ID = 'user-01' as UserId;
export const LOCAL_DATE = localDate('2026-07-20');

const DEVICES = ['phone', 'tablet'] as const;

export interface EventBuilderState {
  readonly clocks: Map<string, Hlc>;
  sequence: number;
}

export function newBuilderState(): EventBuilderState {
  return {
    clocks: new Map(DEVICES.map(device => [device, { wallMillis: 0, counter: 0, nodeId: device }])),
    sequence: 0,
  };
}

export function makeEvent<T extends DomainEventType>(
  state: EventBuilderState,
  device: string,
  wallMillis: number,
  eventType: T,
  payload: DomainEventPayloadMap[T]
): EventEnvelope<T> {
  const current = state.clocks.get(device) ?? { wallMillis: 0, counter: 0, nodeId: device };
  const next: Hlc =
    wallMillis > current.wallMillis
      ? { wallMillis, counter: 0, nodeId: device }
      : { wallMillis: current.wallMillis, counter: current.counter + 1, nodeId: device };
  state.clocks.set(device, next);
  state.sequence += 1;

  return {
    eventId: `evt-${state.sequence.toString().padStart(6, '0')}` as EventId,
    aggregateId: SESSION_ID,
    userId: USER_ID,
    deviceId: device as DeviceId,
    eventType,
    schemaVersion: EVENT_SCHEMA_VERSION,
    hlc: next,
    payload,
    clientCreatedAt: instant(wallMillis),
    serverReceivedAt: null,
    serverSequence: null,
  };
}

export function measurements(loadKg: number, reps: number): SetMeasurements {
  return {
    enteredLoad: loadKg,
    enteredUnit: 'kg',
    canonicalExternalLoadKg: kilograms(loadKg),
    reps,
    durationSeconds: null,
    distanceMeters: null,
    rirEntered: 2,
    rpeEntered: null,
    actualRestSeconds: null,
  };
}

export function qualifiers(): SetQualifiers {
  return { tempo: null, rangeOfMotionNote: null, painFlag: 0, formFlag: false, note: null };
}

export function signature(exerciseId: string): ComparisonSignature {
  return `v1|ex:${exerciseId}|eq:-|ls:external|lem:total|rcm:total|lat:bilateral|rom:full|tempo:standard` as ComparisonSignature;
}

export interface ScriptedSession {
  readonly events: DomainEvent[];
  readonly exerciseIds: SessionExerciseId[];
  readonly setIds: WorkoutSetId[];
}

type Step =
  | { kind: 'addExercise' }
  | { kind: 'logSet' }
  | { kind: 'amendSet'; reps: number }
  | { kind: 'deleteSet' }
  | { kind: 'restoreSet' }
  | { kind: 'reorder' }
  | { kind: 'superset' }
  | { kind: 'substitute' }
  | { kind: 'finish' }
  | { kind: 'reopen' };

const stepArbitrary: fc.Arbitrary<Step> = fc.oneof(
  fc.constant<Step>({ kind: 'addExercise' }),
  fc.constant<Step>({ kind: 'logSet' }),
  fc.constant<Step>({ kind: 'logSet' }),
  fc.integer({ min: 1, max: 20 }).map<Step>(reps => ({ kind: 'amendSet', reps })),
  fc.constant<Step>({ kind: 'deleteSet' }),
  fc.constant<Step>({ kind: 'restoreSet' }),
  fc.constant<Step>({ kind: 'reorder' }),
  fc.constant<Step>({ kind: 'superset' }),
  fc.constant<Step>({ kind: 'substitute' }),
  fc.constant<Step>({ kind: 'finish' }),
  fc.constant<Step>({ kind: 'reopen' })
);

// fast-check's default `size` keeps generated arrays around a dozen elements, which
// produced sessions too small to exercise reorder, superset and delete-vs-amend races
// at all. `size: 'max'` is deliberate: the generator's own coverage is asserted in
// generator-coverage.test.ts so this suite cannot quietly go vacuous again.
export const scriptedSessionArbitrary: fc.Arbitrary<ScriptedSession> = fc
  .tuple(
    fc.integer({ min: 1, max: 4 }),
    fc.array(
      fc.tuple(
        stepArbitrary,
        fc.integer({ min: 0, max: 1 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 99 })
      ),
      { minLength: 8, maxLength: 80, size: 'max' }
    )
  )
  .map(([seedExercises, steps]) => buildSession(steps, seedExercises));

function buildSession(
  steps: readonly (readonly [Step, number, number, number])[],
  seedExercises: number
): ScriptedSession {
  const state = newBuilderState();
  const events: DomainEvent[] = [];
  const exerciseIds: SessionExerciseId[] = [];
  const setIds: WorkoutSetId[] = [];
  let wall = 1_000_000;

  events.push(
    makeEvent(state, 'phone', wall, 'SessionStarted', {
      sessionId: SESSION_ID,
      startedAt: instant(wall),
      localDate: LOCAL_DATE,
      tzOffsetMinutes: 120,
      title: null,
    })
  );

  for (let i = 0; i < seedExercises; i += 1) {
    wall += 1;
    const id = `ex-${(exerciseIds.length + 1).toString().padStart(3, '0')}` as SessionExerciseId;
    exerciseIds.push(id);
    events.push(
      makeEvent(state, 'phone', wall, 'ExerciseAddedToSession', {
        sessionExerciseId: id,
        sessionId: SESSION_ID,
        exerciseDefinitionId: `def-${String(exerciseIds.length)}` as ExerciseDefinitionId,
        equipmentInstanceId: null,
        orderIndex: exerciseIds.length - 1,
        supersetGroupId: null,
        supersetOrder: null,
      })
    );
  }

  // A tick of 0 lets two devices act inside the same wall millisecond, which is the
  // only way delete-vs-amend races and HLC counter tie-breaks get exercised at all.
  const pickFrom = <T>(items: readonly T[], pick: number): T | undefined =>
    items.length === 0 ? undefined : items[pick % items.length];

  for (const [step, deviceIndex, tickMillis, pick] of steps) {
    const device = DEVICES[deviceIndex] ?? 'phone';
    wall += tickMillis;

    switch (step.kind) {
      case 'addExercise': {
        const id =
          `ex-${(exerciseIds.length + 1).toString().padStart(3, '0')}` as SessionExerciseId;
        exerciseIds.push(id);
        events.push(
          makeEvent(state, device, wall, 'ExerciseAddedToSession', {
            sessionExerciseId: id,
            sessionId: SESSION_ID,
            exerciseDefinitionId: `def-${String(exerciseIds.length)}` as ExerciseDefinitionId,
            equipmentInstanceId: null,
            orderIndex: exerciseIds.length - 1,
            supersetGroupId: null,
            supersetOrder: null,
          })
        );
        break;
      }

      case 'logSet': {
        const exerciseId = pickFrom(exerciseIds, pick);
        if (exerciseId == null) break;
        const id = `set-${(setIds.length + 1).toString().padStart(3, '0')}` as WorkoutSetId;
        setIds.push(id);
        events.push(
          makeEvent(state, device, wall, 'SetLogged', {
            setId: id,
            sessionExerciseId: exerciseId,
            orderIndex: setIds.length - 1,
            setType: 'working',
            measurements: measurements(60, 10),
            qualifiers: qualifiers(),
            equipmentInstanceId: null,
            bodyweightKgSnapshot: null,
            bodyweightSource: null,
            bodyweightAgeDays: null,
            prescriptionSnapshot: null,
            exerciseRevisionSnapshot: 1,
            comparisonSignature: signature(exerciseId),
            performedAt: instant(wall),
            localDate: LOCAL_DATE,
            tzOffsetMinutes: 120,
          })
        );
        break;
      }

      case 'amendSet': {
        const setId = pickFrom(setIds, pick);
        if (setId == null) break;
        events.push(
          makeEvent(state, device, wall, 'SetAmended', {
            setId,
            measurements: { reps: step.reps },
          })
        );
        break;
      }

      case 'deleteSet': {
        const setId = pickFrom(setIds, pick);
        if (setId == null) break;
        events.push(makeEvent(state, device, wall, 'SetDeleted', { setId }));
        break;
      }

      case 'restoreSet': {
        const setId = pickFrom(setIds, pick);
        if (setId == null) break;
        events.push(makeEvent(state, device, wall, 'SetRestored', { setId }));
        break;
      }

      case 'reorder': {
        if (exerciseIds.length < 2) break;
        events.push(
          makeEvent(state, device, wall, 'ExerciseReordered', {
            sessionId: SESSION_ID,
            orderedSessionExerciseIds: [...exerciseIds].reverse(),
          })
        );
        break;
      }

      case 'superset': {
        if (exerciseIds.length < 2) break;
        events.push(
          makeEvent(state, device, wall, 'SupersetGroupChanged', {
            sessionId: SESSION_ID,
            groupId: 'ss-001' as SupersetGroupId,
            restMode: 'after_round_only',
            restSecondsIntra: 20,
            restSecondsInter: 150,
            memberSessionExerciseIds: exerciseIds.slice(0, 2),
          })
        );
        break;
      }

      case 'substitute': {
        const exerciseId = pickFrom(exerciseIds, pick);
        if (exerciseId == null) break;
        events.push(
          makeEvent(state, device, wall, 'ExerciseSubstituted', {
            sessionExerciseId: exerciseId,
            toExerciseDefinitionId: 'def-substitute' as ExerciseDefinitionId,
            equipmentInstanceId: null,
          })
        );
        break;
      }

      case 'finish': {
        events.push(
          makeEvent(state, device, wall, 'SessionFinished', {
            sessionId: SESSION_ID,
            finishedAt: instant(wall),
          })
        );
        break;
      }

      case 'reopen': {
        events.push(makeEvent(state, device, wall, 'SessionReopened', { sessionId: SESSION_ID }));
        break;
      }
    }
  }

  return { events, exerciseIds, setIds };
}

export function nowInstant(millis: number): Instant {
  return instant(millis);
}

export const SAMPLE_LOCAL_DATE: LocalDate = LOCAL_DATE;
