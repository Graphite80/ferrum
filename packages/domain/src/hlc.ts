export interface Hlc {
  readonly wallMillis: number;
  readonly counter: number;
  readonly nodeId: string;
}

export const MAX_CLOCK_DRIFT_MILLIS = 60_000;
const MAX_COUNTER = 0xffff;

export class ClockDriftError extends Error {
  constructor(
    readonly observedMillis: number,
    readonly localMillis: number
  ) {
    super(
      `Remote clock is ${String(observedMillis - localMillis)} ms ahead of local, ` +
        `beyond the ${String(MAX_CLOCK_DRIFT_MILLIS)} ms tolerance`
    );
    this.name = 'ClockDriftError';
  }
}

export function hlcZero(nodeId: string): Hlc {
  return { wallMillis: 0, counter: 0, nodeId };
}

// Sortable, fixed-width, lexicographic. The encoded form is what goes into
// IndexedDB indexes and into the sync wire format, so its width must never change
// without a schema version bump.
export function encodeHlc(hlc: Hlc): string {
  const wall = hlc.wallMillis.toString(16).padStart(12, '0');
  const counter = hlc.counter.toString(16).padStart(4, '0');
  return `${wall}:${counter}:${hlc.nodeId}`;
}

export function decodeHlc(encoded: string): Hlc {
  const separator = encoded.indexOf(':');
  const second = encoded.indexOf(':', separator + 1);
  if (separator !== 12 || second !== 17) {
    throw new RangeError(`Malformed HLC "${encoded}"`);
  }
  return {
    wallMillis: Number.parseInt(encoded.slice(0, 12), 16),
    counter: Number.parseInt(encoded.slice(13, 17), 16),
    nodeId: encoded.slice(18),
  };
}

export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.wallMillis !== b.wallMillis) return a.wallMillis < b.wallMillis ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1;
  return 0;
}

export function tick(local: Hlc, nowMillis: number): Hlc {
  if (nowMillis > local.wallMillis) {
    return { wallMillis: nowMillis, counter: 0, nodeId: local.nodeId };
  }
  return bumpCounter(local, local.wallMillis);
}

export function receive(local: Hlc, remote: Hlc, nowMillis: number): Hlc {
  if (remote.wallMillis - nowMillis > MAX_CLOCK_DRIFT_MILLIS) {
    throw new ClockDriftError(remote.wallMillis, nowMillis);
  }
  const wall = Math.max(nowMillis, local.wallMillis, remote.wallMillis);

  if (wall === local.wallMillis && wall === remote.wallMillis) {
    return bumpCounter(local, wall, Math.max(local.counter, remote.counter));
  }
  if (wall === local.wallMillis) {
    return bumpCounter(local, wall, local.counter);
  }
  if (wall === remote.wallMillis) {
    return bumpCounter(local, wall, remote.counter);
  }
  return { wallMillis: wall, counter: 0, nodeId: local.nodeId };
}

function bumpCounter(local: Hlc, wallMillis: number, base = local.counter): Hlc {
  const counter = base + 1;
  if (counter > MAX_COUNTER) {
    // Overflow means more than 65535 events on one node within a single millisecond.
    // Advancing the wall clock is safe: HLC only requires monotonicity, not accuracy.
    return { wallMillis: wallMillis + 1, counter: 0, nodeId: local.nodeId };
  }
  return { wallMillis, counter, nodeId: local.nodeId };
}
