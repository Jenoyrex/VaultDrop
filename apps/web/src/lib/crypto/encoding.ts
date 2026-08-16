/**
 * Internal base64 <-> Uint8Array helpers. Uses `btoa`/`atob`, which are
 * available as globals both in every browser and in Node 18+ (used when
 * running this module's unit tests under Node), so no extra dependency
 * or environment-specific branching is needed.
 */

const CHUNK_SIZE = 0x8000; // avoid call-stack issues with String.fromCharCode(...bytes) on large arrays

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}