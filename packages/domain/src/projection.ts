import { type DomainEvent, type EventId, dedupeEvents, sortEvents } from './events.ts';
import { groupBy } from './utils.ts';
import {
  type Session,
  type SessionExercise,
  type SessionExerciseId,
  type SessionId,
  type SetMeasurements,
  type SetQualifiers,
  type SupersetGroup,
  type SupersetGroupId,
  type WorkoutSet,
  type WorkoutSetId,
} from './set.ts';

export interface AmendmentRecord {
  readonly eventId: EventId;
  readonly setId: WorkoutSetId;
  readonly encodedHlc: string;
  readonly deviceId: string;
  readonly changedFields: readonly string[];
}

export interface ProjectionAnomaly {
  readonly kind:
    | 'event_for_other_session'
    | 'set_without_exercise'
    | 'amend_of_unknown_set'
    | 'delete_of_unknown_set'
    | 'restore_of_unknown_set'
    | 'delete_of_unknown_session'
    | 'restore_of_unknown_session'
    | 'reorder_lists_unknown_exercise'
    | 'duplicate_event_id';
  readonly eventId: EventId;
  readonly detail: string;
}

export interface SessionProjection {
  readonly sessionId: SessionId;
  readonly session: Session | null;
  readonly exercises: readonly SessionExercise[];
  readonly sets: readonly WorkoutSet[];
  readonly deletedSets: readonly WorkoutSet[];
  readonly supersetGroups: readonly SupersetGroup[];
  readonly amendments: readonly AmendmentRecord[];
  readonly anomalies: readonly ProjectionAnomaly[];
  readonly appliedEventCount: number;
}

interface MutableState {
  session: Session | null;
  readonly exercises: Map<SessionExerciseId, SessionExercise>;
  readonly removedExercises: Set<SessionExerciseId>;
  readonly sets: Map<WorkoutSetId, WorkoutSet>;
  readonly supersetGroups: Map<SupersetGroupId, SupersetGroup>;
  readonly amendments: AmendmentRecord[];
  readonly anomalies: ProjectionAnomaly[];
  readonly exerciseOrder: SessionExerciseId[];
  appliedEventCount: number;
}

// The single most important guarantee in the product: the same set of events,
// however they arrived, always produces the same session. Ordering is imposed here
// (dedupe by event id, then total order by HLC + event id) so that no caller can
// accidentally replay in arrival order and get a different answer.
export function projectSession(
  sessionId: SessionId,
  events: readonly DomainEvent[]
): SessionProjection {
  const state: MutableState = {
    session: null,
    exercises: new Map(),
    removedExercises: new Set(),
    sets: new Map(),
    supersetGroups: new Map(),
    amendments: [],
    anomalies: [],
    exerciseOrder: [],
    appliedEventCount: 0,
  };

  const seenEventIds = new Set<EventId>();
  for (const event of events) {
    if (seenEventIds.has(event.eventId)) {
      state.anomalies.push({
        kind: 'duplicate_event_id',
        eventId: event.eventId,
        detail: 'Event id appeared more than once in the input; the later copy was ignored',
      });
    }
    seenEventIds.add(event.eventId);
  }

  for (const event of sortEvents(dedupeEvents(events))) {
    if (event.aggregateId !== sessionId) {
      state.anomalies.push({
        kind: 'event_for_other_session',
        eventId: event.eventId,
        detail: `Event targets session ${event.aggregateId}`,
      });
      continue;
    }
    apply(state, event);
    state.appliedEventCount += 1;
  }

  const orderRank = new Map(state.exerciseOrder.map((id, index) => [id, index]));
  const liveExercises = [...state.exercises.values()]
    .filter(exercise => !state.removedExercises.has(exercise.id))
    .sort(
      (a, b) =>
        (orderRank.get(a.id) ?? a.orderIndex) - (orderRank.get(b.id) ?? b.orderIndex) ||
        (a.id < b.id ? -1 : 1)
    )
    .map((exercise, index) => ({ ...exercise, orderIndex: index }));

  const exerciseRank = new Map(liveExercises.map((exercise, index) => [exercise.id, index]));
  const orderedSets = [...state.sets.values()].sort(
    (a, b) =>
      (exerciseRank.get(a.sessionExerciseId) ?? Number.MAX_SAFE_INTEGER) -
        (exerciseRank.get(b.sessionExerciseId) ?? Number.MAX_SAFE_INTEGER) ||
      a.orderIndex - b.orderIndex ||
      (a.id < b.id ? -1 : 1)
  );

  return {
    sessionId,
    session: state.session,
    exercises: liveExercises,
    sets: orderedSets.filter(
      set => set.status !== 'deleted' && !state.removedExercises.has(set.sessionExerciseId)
    ),
    deletedSets: orderedSets.filter(
      set => set.status === 'deleted' || state.removedExercises.has(set.sessionExerciseId)
    ),
    supersetGroups: [...state.supersetGroups.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    amendments: state.amendments,
    anomalies: state.anomalies,
    appliedEventCount: state.appliedEventCount,
  };
}

export function projectAll(
  events: readonly DomainEvent[]
): ReadonlyMap<SessionId, SessionProjection> {
  const projections = new Map<SessionId, SessionProjection>();
  for (const [sessionId, sessionEvents] of groupBy(events, event => event.aggregateId)) {
    projections.set(sessionId, projectSession(sessionId, sessionEvents));
  }
  return projections;
}

// Sets of a tombstoned session are excluded: deletion exists so a bad record
// stops counting, and every consumer here asks "what did the athlete actually
// do". The events themselves stay in the log, and projectAll still exposes the
// deleted session for anything that needs to show or restore it.
export function allSets(events: readonly DomainEvent[]): WorkoutSet[] {
  return [...projectAll(events).values()]
    .filter(projection => projection.session?.deleted !== true)
    .flatMap(projection => projection.sets);
}

function apply(state: MutableState, event: DomainEvent): void {
  switch (event.eventType) {
    case 'SessionStarted': {
      const payload = event.payload;
      state.session = {
        id: payload.sessionId,
        status: 'active',
        startedAt: payload.startedAt,
        finishedAt: null,
        localDate: payload.localDate,
        tzOffsetMinutes: payload.tzOffsetMinutes,
        title: payload.title,
        note: null,
        amendedAfterFinish: false,
        deleted: false,
      };
      return;
    }

    case 'SessionMetadataChanged': {
      if (state.session == null) return;
      const payload = event.payload;
      state.session = {
        ...state.session,
        title: 'title' in payload ? (payload.title ?? null) : state.session.title,
        note: 'note' in payload ? (payload.note ?? null) : state.session.note,
        amendedAfterFinish: state.session.amendedAfterFinish || state.session.status === 'finished',
      };
      return;
    }

    case 'ExerciseAddedToSession': {
      const payload = event.payload;
      state.exercises.set(payload.sessionExerciseId, {
        id: payload.sessionExerciseId,
        sessionId: payload.sessionId,
        exerciseDefinitionId: payload.exerciseDefinitionId,
        equipmentInstanceId: payload.equipmentInstanceId,
        orderIndex: payload.orderIndex,
        supersetGroupId: payload.supersetGroupId,
        supersetOrder: payload.supersetOrder,
        substitutedFromExerciseDefinitionId: null,
      });
      state.removedExercises.delete(payload.sessionExerciseId);
      if (!state.exerciseOrder.includes(payload.sessionExerciseId)) {
        state.exerciseOrder.push(payload.sessionExerciseId);
      }
      markAmendedIfFinished(state);
      return;
    }

    case 'ExerciseRemovedFromSession': {
      state.removedExercises.add(event.payload.sessionExerciseId);
      markAmendedIfFinished(state);
      return;
    }

    case 'ExerciseReordered': {
      const payload = event.payload;
      const known = payload.orderedSessionExerciseIds.filter(id => state.exercises.has(id));
      for (const id of payload.orderedSessionExerciseIds) {
        if (!state.exercises.has(id)) {
          state.anomalies.push({
            kind: 'reorder_lists_unknown_exercise',
            eventId: event.eventId,
            detail: `Session exercise ${id} is not part of this session`,
          });
        }
      }
      const trailing = state.exerciseOrder.filter(id => !known.includes(id));
      state.exerciseOrder.length = 0;
      state.exerciseOrder.push(...known, ...trailing);
      markAmendedIfFinished(state);
      return;
    }

    case 'ExerciseSubstituted': {
      const payload = event.payload;
      const existing = state.exercises.get(payload.sessionExerciseId);
      if (existing == null) return;
      state.exercises.set(payload.sessionExerciseId, {
        ...existing,
        substitutedFromExerciseDefinitionId:
          existing.substitutedFromExerciseDefinitionId ?? existing.exerciseDefinitionId,
        exerciseDefinitionId: payload.toExerciseDefinitionId,
        equipmentInstanceId: payload.equipmentInstanceId,
      });
      markAmendedIfFinished(state);
      return;
    }

    case 'SupersetGroupChanged': {
      const payload = event.payload;
      state.supersetGroups.set(payload.groupId, {
        id: payload.groupId,
        sessionId: payload.sessionId,
        restMode: payload.restMode,
        restSecondsIntra: payload.restSecondsIntra,
        restSecondsInter: payload.restSecondsInter,
      });
      for (const [id, exercise] of state.exercises) {
        const memberIndex = payload.memberSessionExerciseIds.indexOf(id);
        if (memberIndex >= 0) {
          state.exercises.set(id, {
            ...exercise,
            supersetGroupId: payload.groupId,
            supersetOrder: memberIndex,
          });
        } else if (exercise.supersetGroupId === payload.groupId) {
          state.exercises.set(id, { ...exercise, supersetGroupId: null, supersetOrder: null });
        }
      }
      markAmendedIfFinished(state);
      return;
    }

    case 'SetLogged': {
      const payload = event.payload;
      if (!state.exercises.has(payload.sessionExerciseId)) {
        state.anomalies.push({
          kind: 'set_without_exercise',
          eventId: event.eventId,
          detail: `Set ${payload.setId} references unknown session exercise ${payload.sessionExerciseId}`,
        });
      }
      state.sets.set(payload.setId, {
        id: payload.setId,
        sessionExerciseId: payload.sessionExerciseId,
        orderIndex: payload.orderIndex,
        setType: payload.setType,
        status: 'completed',
        measurements: payload.measurements,
        qualifiers: payload.qualifiers,
        equipmentInstanceId: payload.equipmentInstanceId,
        bodyweightKgSnapshot: payload.bodyweightKgSnapshot,
        bodyweightSource: payload.bodyweightSource,
        bodyweightAgeDays: payload.bodyweightAgeDays,
        prescriptionSnapshot: payload.prescriptionSnapshot,
        exerciseRevisionSnapshot: payload.exerciseRevisionSnapshot,
        comparisonSignature: payload.comparisonSignature,
        provenance: payload.provenance,
        performedAt: payload.performedAt,
        recordedAt: event.clientCreatedAt,
        localDate: payload.localDate,
        tzOffsetMinutes: payload.tzOffsetMinutes,
        sourceDeviceId: event.deviceId,
      });
      markAmendedIfFinished(state);
      return;
    }

    case 'SetAmended': {
      const payload = event.payload;
      const existing = state.sets.get(payload.setId);
      if (existing == null) {
        state.anomalies.push({
          kind: 'amend_of_unknown_set',
          eventId: event.eventId,
          detail: `Set ${payload.setId} has not been logged in this session`,
        });
        return;
      }

      const changedFields: string[] = [];
      const measurements = mergeDefined<SetMeasurements>(
        existing.measurements,
        payload.measurements,
        changedFields,
        'measurements'
      );
      const qualifiers = mergeDefined<SetQualifiers>(
        existing.qualifiers,
        payload.qualifiers,
        changedFields,
        'qualifiers'
      );

      if (payload.setType !== undefined) changedFields.push('setType');
      if (payload.equipmentInstanceId !== undefined) changedFields.push('equipmentInstanceId');
      if (payload.comparisonSignature !== undefined) changedFields.push('comparisonSignature');

      // Amending a tombstoned set updates its contents but never resurrects it.
      // Undo is an explicit SetRestored, so a delete racing an edit has one answer.
      state.sets.set(payload.setId, {
        ...existing,
        setType: payload.setType ?? existing.setType,
        measurements,
        qualifiers,
        equipmentInstanceId:
          payload.equipmentInstanceId !== undefined
            ? payload.equipmentInstanceId
            : existing.equipmentInstanceId,
        comparisonSignature: payload.comparisonSignature ?? existing.comparisonSignature,
      });

      state.amendments.push({
        eventId: event.eventId,
        setId: payload.setId,
        encodedHlc: `${event.hlc.wallMillis.toString(16)}:${event.hlc.counter.toString(16)}`,
        deviceId: event.deviceId,
        changedFields,
      });
      markAmendedIfFinished(state);
      return;
    }

    case 'SetDeleted': {
      const existing = state.sets.get(event.payload.setId);
      if (existing == null) {
        state.anomalies.push({
          kind: 'delete_of_unknown_set',
          eventId: event.eventId,
          detail: `Set ${event.payload.setId} has not been logged in this session`,
        });
        return;
      }
      state.sets.set(event.payload.setId, { ...existing, status: 'deleted' });
      markAmendedIfFinished(state);
      return;
    }

    case 'SetRestored': {
      const existing = state.sets.get(event.payload.setId);
      if (existing == null) {
        state.anomalies.push({
          kind: 'restore_of_unknown_set',
          eventId: event.eventId,
          detail: `Set ${event.payload.setId} has not been logged in this session`,
        });
        return;
      }
      state.sets.set(event.payload.setId, { ...existing, status: 'completed' });
      markAmendedIfFinished(state);
      return;
    }

    case 'SessionFinished': {
      if (state.session == null) return;
      state.session = {
        ...state.session,
        status: 'finished',
        finishedAt: event.payload.finishedAt,
      };
      return;
    }

    case 'SessionReopened': {
      if (state.session == null) return;
      state.session = { ...state.session, status: 'active', finishedAt: null };
      return;
    }

    // A session tombstone, mirroring the set tombstone of INVARIANTS §7: deletion is a
    // flag flip, never a removal. Every exercise, set and amendment stays in the
    // projection, and delete → restore → delete converges through the total event order.
    case 'SessionDeleted': {
      if (state.session == null) {
        state.anomalies.push({
          kind: 'delete_of_unknown_session',
          eventId: event.eventId,
          detail: `Session ${event.payload.sessionId} has no SessionStarted in this log`,
        });
        return;
      }
      state.session = { ...state.session, deleted: true };
      return;
    }

    case 'SessionRestored': {
      if (state.session == null) {
        state.anomalies.push({
          kind: 'restore_of_unknown_session',
          eventId: event.eventId,
          detail: `Session ${event.payload.sessionId} has no SessionStarted in this log`,
        });
        return;
      }
      state.session = { ...state.session, deleted: false };
      return;
    }
  }
}

// Only keys actually present in the amendment overwrite the base. Field-level
// last-writer-wins then falls out of the total event order for free: the last event
// to mention a field is the one that set it, on every replica.
function mergeDefined<T extends object>(
  base: T,
  patch: Partial<T> | undefined,
  changedFields: string[],
  prefix: string
): T {
  if (patch == null) return base;
  const defined: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    defined[key] = value;
    changedFields.push(`${prefix}.${key}`);
  }
  return { ...base, ...defined };
}

function markAmendedIfFinished(state: MutableState): void {
  if (state.session != null && state.session.status === 'finished') {
    state.session = { ...state.session, amendedAfterFinish: true };
  }
}
