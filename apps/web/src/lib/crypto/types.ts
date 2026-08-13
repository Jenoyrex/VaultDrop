/**
 * Shared types for the browser-only crypto module.
 *
 * IMPORTANT: this module is Phase 0 groundwork only. It is built and
 * unit-tested in isolation and is not imported anywhere else in the
 * running application yet. See the Phase 0 plan for scope.
 */

/**
 * Raw AES-256 key material, 32 bytes.
 *
 * Explicitly parameterized as `Uint8Array<ArrayBuffer>` (not the bare
 * `Uint8Array`) because TypeScript 5.7+ changed `Uint8Array`'s default
 * generic parameter to `ArrayBufferLike` (which includes
 * `SharedArrayBuffer`), and Web Crypto's `BufferSource` type requires
 * the concrete `ArrayBuffer` variant. Every byte buffer in this module
 * that's meant to be fed to `crypto.subtle.*` uses this same pattern.
 */
export type RawKey = Uint8Array<ArrayBuffer>;

/** An AES-256-GCM-wrapped key, ready for storage/transport as strings. */
export interface WrappedKey {
  /** Base64-encoded ciphertext (includes the GCM auth tag). */
  ciphertext: string;
  /** Base64-encoded 12-byte IV used for this specific wrap operation. */
  iv: string;
}

/** Parameters describing how a Key-Encryption-Key was derived from a password. */
export interface KekDerivationParams {
  /** Base64-encoded 16-byte random salt. */
  salt: string;
  /** PBKDF2 iteration count. */
  iterations: number;
  /** Hash algorithm used by PBKDF2. */
  hash: "SHA-256";
}

/** Result of encrypting a short piece of text (e.g. a name) with AES-GCM. */
export interface EncryptedTextPayload {
  /** Base64-encoded ciphertext (includes the GCM auth tag). */
  ciphertext: string;
  /** Base64-encoded 12-byte IV. */
  iv: string;
}