const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RANDOM_LENGTH = 16;
const TIME_LENGTH = 10;

function encodeTime(millis: number): string {
  let remaining = millis;
  let out = '';
  for (let i = 0; i < TIME_LENGTH; i += 1) {
    out = CROCKFORD[remaining % 32] + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

function randomChars(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += CROCKFORD[byte % 32];
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
  const chars = [...value];
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const char = chars[i];
    if (char === undefined) break;
    const index = CROCKFORD.indexOf(char);
    if (index < CROCKFORD.length - 1) {
      chars[i] = CROCKFORD[index + 1] as string;
      return chars.join('');
    }
    chars[i] = CROCKFORD[0] as string;
  }
  return chars.join('');
}

export const ulidFactory = new UlidFactory(length =>
  crypto.getRandomValues(new Uint8Array(length))
);

export function newDeviceId(): string {
  return `dev_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}
