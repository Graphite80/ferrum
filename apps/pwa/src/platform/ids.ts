const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RANDOM_LENGTH = 16;
const TIME_LENGTH = 10;

function symbolAt(index: number): string {
  const symbol = CROCKFORD[index];
  if (symbol === undefined) throw new RangeError(`Crockford index ${String(index)} out of range`);
  return symbol;
}

function encodeTime(millis: number): string {
  let remaining = millis;
  let out = '';
  for (let i = 0; i < TIME_LENGTH; i += 1) {
    out = symbolAt(remaining % 32) + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

function randomChars(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += symbolAt(byte % 32);
  return out;
}

// ULID rather than UUIDv7 because the encoded form sorts lexicographically as a
// plain string, which is what both the IndexedDB index and the event total order
// rely on. Monotonic within a millisecond so two sets logged in the same tick keep
// their real order instead of tie-breaking arbitrarily.
export class UlidFactory {
  private lastMillis = -1;
  private lastRandom = '';

  constructor(private readonly randomBytes: (length: number) => Uint8Array) {}

  next(nowMillis: number): string {
    if (nowMillis === this.lastMillis) {
      this.lastRandom = incrementCrockford(this.lastRandom);
      return encodeTime(nowMillis) + this.lastRandom;
    }
    this.lastMillis = nowMillis;
    this.lastRandom = randomChars(this.randomBytes(RANDOM_LENGTH));
    return encodeTime(nowMillis) + this.lastRandom;
  }
}

function incrementCrockford(value: string): string {
  let out = value;
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const index = CROCKFORD.indexOf(out.charAt(i));
    if (index < CROCKFORD.length - 1) {
      return out.slice(0, i) + symbolAt(index + 1) + out.slice(i + 1);
    }
    out = out.slice(0, i) + symbolAt(0) + out.slice(i + 1);
  }
  return out;
}

export const ulidFactory = new UlidFactory(length =>
  crypto.getRandomValues(new Uint8Array(length))
);

export function newDeviceId(): string {
  return `dev_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}
