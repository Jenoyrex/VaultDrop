/**
 * Browser-only, zero-knowledge encryption primitives for VaultDrop.
 *
 * As of Phase 1 Checkpoint 3, this module is wired into vault creation
 * and vault unlock (see `lib/vault-keys.ts` and
 * `components/providers/vault-key-provider.tsx`) to derive KEKs and
 * hold unwrapped vault DEKs in browser memory only. File upload/download
 * encryption and recovery are still not wired in — that remains scope
 * for a later, separately-approved checkpoint.
 */

export * from "./types.js";
export * from "./random.js";
export * from "./kdf.js";
export * from "./key-wrap.js";
export * from "./chunked-cipher.js";
export * from "./text-cipher.js";
export * from "./recovery-key.js";