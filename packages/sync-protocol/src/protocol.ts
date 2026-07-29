import { dedupeEvents, sortEvents, type DomainEvent } from '@ferrum/domain';

export const PULL_DEFAULT_LIMIT = 500;
export const PUSH_MAX_EVENTS = 1000;
export const PULL_MAX_LIMIT = 1000;
export const PURGE_MAX_AGGREGATES = 100;

export interface PushRequest {
  readonly deviceId: string;
  readonly events: readonly DomainEvent[];
}

export interface PushResponse {
  readonly accepted: number;
  readonly duplicates: number;
  readonly purged: number;
  readonly cursor: number;
}

export interface PullRequest {
  readonly afterSequence: number;
  readonly limit: number;
  readonly afterPurgeSequence: number;
}

// A purge is the one operation that leaves the append-only log: the rows are gone
// server-side, so a replica can only learn about it from a separate journal that
// carries its own cursor. Without it the deleting device is the only one that ever
// forgets, and every other device keeps replaying a workout the user erased.
export interface PurgedAggregate {
  readonly aggregateId: string;
  readonly sequence: number;
}

export interface PullResponse {
  readonly events: readonly DomainEvent[];
  readonly cursor: number;
  readonly hasMore: boolean;
  readonly purges: readonly PurgedAggregate[];
  readonly purgeCursor: number;
}

export interface PurgeRequest {
  readonly aggregateIds: readonly string[];
}

export interface PurgeResponse {
  readonly purgedEvents: number;
  readonly purgeCursor: number;
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
