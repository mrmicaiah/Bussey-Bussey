/**
 * Cryptographically secure temp password generator.
 *
 * 16 characters from an unambiguous alphabet — drops 0/O/1/I/l to reduce
 * read-aloud confusion when admins share credentials over the phone. Length
 * and alphabet yield > 90 bits of entropy, well above any practical threshold
 * for a credential the client rotates on first login.
 */

const TEMP_PASSWORD_LENGTH = 16;
const TEMP_PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZ' + 'abcdefghijkmnopqrstuvwxyz' + '23456789';

export function generateTempPassword(): string {
  const buf = new Uint8Array(TEMP_PASSWORD_LENGTH);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    out += TEMP_PASSWORD_ALPHABET.charAt(buf[i]! % TEMP_PASSWORD_ALPHABET.length);
  }
  return out;
}

/** TTL of the plaintext temp password cached in KV — the 24h re-display window. */
export const CREDENTIALS_TTL_SECONDS = 60 * 60 * 24;

/** Same window expressed in milliseconds for `Date.getTime()` comparisons. */
export const CREDENTIALS_WINDOW_MS = CREDENTIALS_TTL_SECONDS * 1000;
