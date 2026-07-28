import { dedupeEvents, sortEvents, type DomainEvent } from '@ferrum/domain';

export const PULL_DEFAULT_LIMIT = 500;
export const PULL_MAX_LIMIT = 1000;

export interface PushRequest {
  readonly deviceId: string;
  readonly events: readonly DomainEvent[];
}

export interface PushResponse {
  readonly accepted: number;
  readonly duplicates: number;
  readonly cursor: number;
}

export interface PullRequest {
  readonly afterSequence: number;
  readonly limit: number;
}

export interface PullResponse {
  readonly events: readonly DomainEvent[];
  readonly cursor: number;
  readonly hasMore: boolean;
}

export interface ClockDriftRejection {
  readonly code: 'clock_drift';
  readonly driftedEventIds: readonly string[];
}

export function mergeEventLogs(
  local: readonly DomainEvent[],
  remote: readonly DomainEvent[]
): DomainEvent[] {
  return sortEvents(dedupeEvents([...local, ...remote]));
}
