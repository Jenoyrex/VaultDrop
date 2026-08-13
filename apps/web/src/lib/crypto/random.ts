/**
 * Random byte and AES-256 key generation/import/export helpers, built
 * entirely on the Web Crypto API (`crypto.getRandomValues`, `crypto.subtle`).
 */

/**
 * `crypto.getRandomValues()` rejects requests larger than 65536 bytes in
 * a single call (both in browsers and in Node). This chunks larger
 * requests so callers never have to think about that limit.
 */
const MAX_GET_RANDOM_VALUES_BYTES = 65536;

export function generateRandomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);

  for (let offset = 0; offset < length; offset += MAX_GET_RANDOM_VALUES_BYTES) {
    const end = Math.min(offset + MAX_GET_RANDOM_VALUES_BYTES, length);
    crypto.getRandomValues(bytes.subarray(offset, end));
  }

  return bytes;
}

/**
 * Generates a new random AES-256-GCM key. `extractable: true` is required
 * so the key can later be exported/wrapped for storage — see the Phase 0
 * plan's "security concerns" section for the accepted tradeoff this implies.
 */
export async function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256
    },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  );
}

export async function exportKeyRaw(key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return new Uint8Array(raw);
}

export async function importAesKeyRaw(
  raw: Uint8Array<ArrayBuffer>,
  usages: KeyUsage[] = ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: 256 },
    true,
    usages
  );
}