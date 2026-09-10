import crypto from 'crypto';

export type IdPrefix =
  | 'usr'
  | 'subj'
  | 'chap'
  | 'evt'
  | 'sess'
  | 'prog'
  | 'daily'
  | 'src'
  | 'srcchap'
  | 'map'
  | 'tasklink'
  | 'callink'
  | 'schedlink'
  | 'proj'
  | 'progevt'
  | 'resevt'
  | 'dec'
  | 'mem'
  | 'memver'
  | 'agentrun'
  | 'snap'
  | 'chk'
  | 'sync'
  | 'idemp'
  | 'req'
  | 'corr';

const CROCKFORD_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generates a ULID-compatible Crockford Base32 string (timestamp 48-bit + 80-bit random).
 */
export function generateUlid(timestamp: number = Date.now()): string {
  // Timestamp component (10 chars = 50 bits)
  let timeStr = '';
  let time = timestamp;
  for (let i = 0; i < 10; i++) {
    const mod = time % 32;
    timeStr = CROCKFORD_CHARS[mod] + timeStr;
    time = Math.floor(time / 32);
  }

  // Random component (16 chars = 80 bits)
  const randomBytes = crypto.randomBytes(10);
  let randStr = '';
  for (let i = 0; i < 16; i++) {
    const byteIndex = Math.floor((i * 5) / 8);
    const bitOffset = (i * 5) % 8;
    let val: number;
    if (bitOffset <= 3) {
      val = (randomBytes[byteIndex] >> (3 - bitOffset)) & 31;
    } else {
      const b1 = randomBytes[byteIndex] & (255 >> bitOffset);
      const b2 = byteIndex + 1 < randomBytes.length ? randomBytes[byteIndex + 1] : 0;
      val = ((b1 << (bitOffset - 3)) | (b2 >> (11 - bitOffset))) & 31;
    }
    randStr += CROCKFORD_CHARS[val % 32];
  }

  return timeStr + randStr;
}

/**
 * Generates a stable opaque ID with a standard domain prefix (e.g. `usr_01J...`).
 */
export function generateId(prefix: IdPrefix, timestamp: number = Date.now()): string {
  return `${prefix}_${generateUlid(timestamp)}`;
}

/**
 * Validates whether a given string is a correctly formatted opaque ID.
 */
export function isValidId(id: string, expectedPrefix?: IdPrefix): boolean {
  if (!id || typeof id !== 'string') return false;
  const parts = id.split('_');
  if (parts.length !== 2) return false;
  const [prefix, suffix] = parts;
  if (expectedPrefix && prefix !== expectedPrefix) return false;
  if (suffix.length < 20 || suffix.length > 30) return false;
  const validCharsRegex = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/i;
  return validCharsRegex.test(suffix);
}
