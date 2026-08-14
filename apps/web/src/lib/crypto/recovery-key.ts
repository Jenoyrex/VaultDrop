/**
 * Recovery-key generation and text-encoding, kept separate from
 * `key-wrap.ts`/`random.ts` because it's the only place in this module
 * that deals with a *human-facing* string form of key material — every
 * other primitive here only ever handles bytes or base64.
 *
 * The recovery key itself is 256 bits of raw random entropy (`RawKey`),
 * used directly (via `importAesKeyRaw`) as an AES-256-GCM wrapping key —
 * no PBKDF2, no salt, no iteration count. That's safe specifically
 * because this key is generated with full entropy already, unlike a
 * human password; deriving further from it would add nothing.
 */
import type { RawKey } from "./types.js";
import { generateRandomBytes } from "./random.js";

const RECOVERY_KEY_BYTES = 32;
const RECOVERY_KEY_PREFIX = "VDR1";
const GROUP_SIZE = 4;

/**
 * Crockford's Base32 alphabet: excludes I, L, O, U to avoid
 * transcription/lookalike ambiguity (0/O, 1/I/L). Case-insensitive by
 * convention — `parseRecoveryKey` upper-cases input before decoding.
 */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32Crockford(bytes: Uint8Array): string {
  let bitBuffer = 0;
  let bitCount = 0;
  let output = "";

  for (const byte of bytes) {
    bitBuffer = (bitBuffer << 8) | byte;
    bitCount += 8;

    while (bitCount >= 5) {
      const shift = bitCount - 5;
      output += CROCKFORD_ALPHABET[(bitBuffer >>> shift) & 0x1f];
      bitCount -= 5;
      bitBuffer &= (1 << bitCount) - 1;
    }
  }

  if (bitCount > 0) {
    output += CROCKFORD_ALPHABET[(bitBuffer << (5 - bitCount)) & 0x1f];
  }

  return output;
}

function decodeBase32Crockford(text: string): RawKey {
  const maxBytes = Math.floor((text.length * 5) / 8);
  const bytes = new Uint8Array(maxBytes);
  let byteIndex = 0;
  let bitBuffer = 0;
  let bitCount = 0;

  for (const char of text) {
    const index = CROCKFORD_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Recovery key contains an invalid character: "${char}"`);
    }
    bitBuffer = (bitBuffer << 5) | index;
    bitCount += 5;

    if (bitCount >= 8) {
      const shift = bitCount - 8;
      bytes[byteIndex] = (bitBuffer >>> shift) & 0xff;
      byteIndex += 1;
      bitCount -= 8;
      bitBuffer &= (1 << bitCount) - 1;
    }
  }

  return bytes as RawKey;
}

/** Formats raw recovery-key bytes as a copy-pasteable code, e.g. `VDR1-XXXX-XXXX-...`. */
export function formatRecoveryKey(bytes: Uint8Array): string {
  const encoded = encodeBase32Crockford(bytes);
  const groups: string[] = [];

  for (let i = 0; i < encoded.length; i += GROUP_SIZE) {
    groups.push(encoded.slice(i, i + GROUP_SIZE));
  }

  return [RECOVERY_KEY_PREFIX, ...groups].join("-");
}

/**
 * Parses a user-entered recovery key back into raw bytes. Tolerant of
 * surrounding whitespace and letter case (recovery keys are meant to be
 * copy-pasted, not memorized); rejects anything that isn't a
 * well-formed, correctly-sized VDR1 code with a clear error rather than
 * silently producing wrong bytes that would just fail later at
 * `unwrapKey` with a less helpful message.
 */
export function parseRecoveryKey(formatted: string): RawKey {
  const normalized = formatted.trim().toUpperCase().replace(/\s+/g, "");
  const segments = normalized.split("-").filter((segment) => segment.length > 0);

  if (segments[0] !== RECOVERY_KEY_PREFIX) {
    throw new Error('Recovery key format not recognized (expected it to start with "VDR1-")');
  }

  const encoded = segments.slice(1).join("");
  const bytes = decodeBase32Crockford(encoded);

  if (bytes.length !== RECOVERY_KEY_BYTES) {
    throw new Error("Recovery key is the wrong length");
  }

  return bytes;
}

/** Generates a brand-new recovery key: raw bytes plus its display form. */
export function generateRecoveryKey(): { bytes: RawKey; formatted: string } {
  const bytes = generateRandomBytes(RECOVERY_KEY_BYTES);
  return { bytes, formatted: formatRecoveryKey(bytes) };
}
