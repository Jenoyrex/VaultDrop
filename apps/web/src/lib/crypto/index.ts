/**
 * Browser-only, zero-knowledge encryption primitives for VaultDrop.
 *
 * Phase 0 status: this module is built and unit-tested in isolation.
 * It is NOT imported anywhere else in the application yet — no UI, no
 * API calls, and no uploaded/downloaded file ever passes through this
 * module today. Wiring it in is explicitly out of scope until a later,
 * separately-approved phase.
 */

export * from "./types.js";
export * from "./random.js";
export * from "./kdf.js";
export * from "./key-wrap.js";
export * from "./chunked-cipher.js";
export * from "./text-cipher.js";