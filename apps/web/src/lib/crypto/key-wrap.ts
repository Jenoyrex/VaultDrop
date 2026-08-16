import type { WrappedKey } from "./types.js";
import { generateRandomBytes } from "./random.js";
import { bytesToBase64, base64ToBytes } from "./encoding.js";

const IV_LENGTH_BYTES = 12;

/**
 * Wraps (encrypts) `keyToWrap` using `wrappingKey`. A fresh random IV is
 * generated for every call, even when wrapping the same key repeatedly
 * (e.g. across a future password change) — IVs must never be reused.
 */
export async function wrapKey(
  keyToWrap: CryptoKey,
  wrappingKey: CryptoKey
): Promise<WrappedKey> {
  const iv = generateRandomBytes(IV_LENGTH_BYTES);

  const ciphertext = await crypto.subtle.wrapKey(
    "raw",
    keyToWrap,
    wrappingKey,
    { name: "AES-GCM", iv }
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv)
  };
}

/**
 * Unwraps (decrypts) a previously-wrapped key. Rejects if `wrappingKey`
 * is wrong or if `wrapped` has been tampered with (AES-GCM's built-in
 * authentication tag makes tampering detectable).
 */
export async function unwrapKey(
  wrapped: WrappedKey,
  wrappingKey: CryptoKey,
  unwrappedKeyUsages: KeyUsage[]
): Promise<CryptoKey> {
  const ciphertext = base64ToBytes(wrapped.ciphertext);
  const iv = base64ToBytes(wrapped.iv);

  return crypto.subtle.unwrapKey(
    "raw",
    ciphertext,
    wrappingKey,
    { name: "AES-GCM", iv },
    { name: "AES-GCM", length: 256 },
    true,
    unwrappedKeyUsages
  );
}