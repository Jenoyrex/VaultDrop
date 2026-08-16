import type { KekDerivationParams } from "./types.js";
import { generateRandomBytes } from "./random.js";
import { bytesToBase64, base64ToBytes } from "./encoding.js";

/**
 * Default PBKDF2 iteration count, per current OWASP guidance for
 * PBKDF2-HMAC-SHA256. Stored per-vault (in a later phase) so it can be
 * raised over time without breaking previously-derived keys.
 */
export const DEFAULT_KDF_ITERATIONS = 600_000;

const SALT_LENGTH_BYTES = 16;

/**
 * Derives a Key-Encryption-Key (KEK) from a password using PBKDF2-SHA256.
 * Never sends the password anywhere — this runs entirely client-side.
 *
 * If `params` is omitted, a fresh random salt and the default iteration
 * count are used (the case for deriving a *new* KEK, e.g. at vault
 * creation). Pass an existing `params` (salt + iterations) to re-derive
 * the same KEK later, e.g. to unlock on a different device.
 */
export async function deriveKek(
  password: string,
  params?: Partial<KekDerivationParams>
): Promise<{ key: CryptoKey; params: KekDerivationParams }> {
  const salt = params?.salt
    ? base64ToBytes(params.salt)
    : generateRandomBytes(SALT_LENGTH_BYTES);

  const iterations = params?.iterations ?? DEFAULT_KDF_ITERATIONS;
  const hash: KekDerivationParams["hash"] = params?.hash ?? "SHA-256";

  const passwordBytes = new TextEncoder().encode(password);

  const baseKey = await crypto.subtle.importKey(
    "raw",
    passwordBytes,
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["wrapKey", "unwrapKey", "encrypt", "decrypt"]
  );

  return {
    key,
    params: {
      salt: bytesToBase64(salt),
      iterations,
      hash
    }
  };
}