import type { EncryptedTextPayload } from "./types.js";
import { generateRandomBytes } from "./random.js";
import { bytesToBase64, base64ToBytes } from "./encoding.js";

const IV_LENGTH_BYTES = 12;

/** Encrypts a short UTF-8 string (e.g. a name) with AES-256-GCM. */
export async function encryptText(
  plaintext: string,
  key: CryptoKey
): Promise<EncryptedTextPayload> {
  const iv = generateRandomBytes(IV_LENGTH_BYTES);
  const plaintextBytes = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintextBytes
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv)
  };
}

/**
 * Decrypts a payload produced by `encryptText`. Rejects if the wrong key
 * is used or if the payload has been tampered with.
 */
export async function decryptText(
  payload: EncryptedTextPayload,
  key: CryptoKey
): Promise<string> {
  const ciphertext = base64ToBytes(payload.ciphertext);
  const iv = base64ToBytes(payload.iv);

  const plaintextBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(plaintextBytes);
}