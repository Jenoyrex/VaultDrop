import { webcrypto as nodeCrypto } from "node:crypto";

// Node 18 (the version pinned in CI) doesn't expose `globalThis.crypto`
// without an experimental flag — it was only made global-by-default in
// Node 19+. Vitest's "node" environment doesn't polyfill it either, so
// any test that touches the Web Crypto API fails there even though it
// passes locally on newer Node. Guarded so this is a no-op wherever
// `crypto` is already global (Node 19+, browsers, jsdom).
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = nodeCrypto as unknown as Crypto;
}
