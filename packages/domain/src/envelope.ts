import {
  type DomainEvent,
  type DomainEventPayloadMap,
  type DomainEventType,
  type EventEnvelope,
} from './events.ts';

export type EventEnvelopeRest = Omit<EventEnvelope, 'eventType' | 'payload'>;

export type DomainEventBody = {
  [T in DomainEventType]: {
    readonly eventType: T;
    readonly payload: DomainEventPayloadMap[T];
  };
}[DomainEventType];

export function buildEvent<T extends DomainEventType>(
  eventType: T,
  payload: DomainEventPayloadMap[T],
  rest: Omit<EventEnvelope<T>, 'eventType' | 'payload'>
): EventEnvelope<T> {
  return { ...rest, eventType, payload };
}

// TypeScript cannot carry an eventType/payload correlation through a union value, so
// every caller holding a DomainEventBody would otherwise cast. The exhaustive switch
// re-proves the correlation member by member; a new event type fails compilation here
// instead of silently widening at scattered call sites.
export function buildDomainEvent(body: DomainEventBody, rest: EventEnvelopeRest): DomainEvent {
  switch (body.eventType) {
    case 'SessionStarted':
      return buildEvent(body.eventType, body.payload, rest);
    case 'SessionMetadataChanged':
      return buildEvent(body.eventType, body.payload, rest);
    case 'ExerciseAddedToSession':
      return buildEvent(body.eventType, body.payload, rest);
    case 'ExerciseRemovedFromSession':
      return buildEvent(body.eventType, body.payload, rest);
    case 'ExerciseReordered':
      return buildEvent(body.eventType, body.payload, rest);
    case 'ExerciseSubstituted':
      return buildEvent(body.eventType, body.payload, rest);
    case 'SupersetGroupChanged':
      return buildEvent(body.eventType, body.payload, rest);
    case 'SetLogged':
      return buildEvent(body.eventType, body.payload, rest);
    case 'SetAmended':
      return buildEvent(body.eventType, body.payload, rest);
    case 'SetDeleted':
      return buildEvent(body.eventType, body.payload, rest);
    case 'SetRestored':
      return buildEvent(body.eventType, body.payload, rest);
    case 'SessionFinished':
      return buildEvent(body.eventType, body.payload, rest);
    case 'SessionReopened':
      return buildEvent(body.eventType, body.payload, rest);
  }
}
