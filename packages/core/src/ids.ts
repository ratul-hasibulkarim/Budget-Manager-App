/** Random ids that are safe to generate offline on any device. */

type RandomBytes = (n: number) => Uint8Array;

const defaultRandomBytes: RandomBytes = (n) => {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (!c?.getRandomValues) throw new Error('No secure random source available');
  return c.getRandomValues(new Uint8Array(n));
};

let randomBytes: RandomBytes = defaultRandomBytes;

/** Lets the app plug in its platform's secure random source. */
export function setRandomSource(fn: RandomBytes) {
  randomBytes = fn;
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 22 characters from a 62-letter alphabet ≈ 131 bits of randomness. */
export function newId(): string {
  const bytes = randomBytes(22);
  let out = '';
  for (const b of bytes) out += ID_ALPHABET[b % 62];
  return out;
}

// No 0/O, 1/I/L to avoid confusion when typed by hand.
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newInviteCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
  return out;
}
