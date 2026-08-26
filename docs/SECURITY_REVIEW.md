# Security Review

**Scope:** A maintainer-performed source-level review of VaultDrop's
authentication, authorization, encryption, and API-hardening code, cross-
checked against the automated test suite. This is a documented
self-assessment, not an independent third-party audit or penetration
test — see `SECURITY.md` for how to report anything this review missed.

**Method:** Manual reading of the server (`apps/server`), the client-side
crypto and upload/download pipelines (`apps/web/src/lib`), the shared
crypto/config packages (`packages/crypto`, `packages/config`), and the
Prisma schema, together with running the existing Vitest suite (243 tests
across both apps as of this review) to confirm the properties below are
actually exercised, not just asserted in prose.

**Date:** 2026-08-26. **Reviewed against:** the `main`-tracked state of
this repository at the time of writing; VaultDrop does not tag releases,
so there is no separate version number to pin this review to.

---

## Security properties present in the implementation

**Client-side encryption architecture.** A vault's Data Encryption Key
(DEK) is generated in the browser and never transmitted in plaintext. It
is wrapped twice: once by a PBKDF2-SHA256-derived Key-Encryption-Key
(KEK) from the account password, and once by a separately generated,
user-held recovery key — both using AES-256-GCM
(`apps/web/src/lib/crypto/kdf.ts`, `key-wrap.ts`). File contents are
encrypted client-side in chunks with a per-file key wrapped by the vault
DEK (`apps/web/src/lib/crypto/chunked-cipher.ts`), and file/folder names
are encrypted the same way before ever reaching the server
(`apps/server/src/routes/encrypted-names.test.ts` verifies no plaintext
name reaches the DB row, storage key, or any API response for an
encrypted vault). The Prisma schema (`apps/server/prisma/schema.prisma`)
stores only ciphertext, wrapped keys, IVs, and KDF parameters — there is
no column capable of holding a plaintext password, KEK, DEK, or recovery
key.

**Password hashing.** Argon2id via the `argon2` library
(`packages/crypto/src/password.ts`), with explicit parameters (19 MiB
memory cost, time cost 2) rather than library defaults, matching OWASP's
current baseline recommendation for interactive login paths.

**Session tokens.** JWTs are signed and verified with an explicit `HS256`
algorithm allow-list (`packages/crypto/src/jwt.ts`), so a token cannot be
forged by asserting a different algorithm (e.g. `none`) even if the
underlying library's own defaults ever changed. Tokens carry a short,
configurable expiry (`JWT_EXPIRES_IN`, 15 minutes by default).

**Authorization.** Every service method that touches a vault, folder, or
file resolves ownership through a single, consistently-used check
(`VaultService.getOwnedVaultOrThrow`, `FileService.getFileOrThrow`, the
equivalent in `FolderService`) rather than ad hoc per-route logic — a
request for another user's vault/file/folder is rejected with 403/404
before any data is read or returned. `upload.test.ts` includes an explicit
regression test for uploading into a vault the caller doesn't own.

**Path traversal protection.** `LocalStorageAdapter.resolveKeyPath`
normalizes and resolves every storage key against the configured storage
root and rejects any key that would resolve outside it
(`apps/server/src/storage/local-storage-adapter.ts`). Encrypted uploads
never embed the plaintext filename in the storage key, so a filename
can't leak into a filesystem path, S3 object key, or server log even
indirectly.

**Rate limiting.** Layered, per-authenticated-user (not per-IP) budgets
for credential routes, username-enumeration, and general/upload/download
API traffic (`apps/server/src/middleware/rate-limit.ts`), verified by
`api-rate-limit.test.ts` (independent budgets, correct sharing between
route pairs, rejection before storage/body consumption) and
`auth-trust-proxy.test.ts` (correct behavior with and without a trusted
reverse proxy, and that a spoofed `X-Forwarded-For` cannot manipulate the
rate-limit key when no proxy is trusted).

**Transactional, atomic password change.** `AuthService.changePassword`
re-reads the account's live set of encrypted vaults inside a single DB
transaction and rejects the entire operation — before touching
`User.passwordHash` or any vault row — if the client's submitted re-wrap
set doesn't exactly match. `auth-password-change.test.ts` includes an
explicit rollback test simulating a mid-transaction failure and asserting
nothing (including an already-applied update) survives it.

**Recovery-key isolation.** The recovery-wrapped DEK is never included in
the general vault DTO returned by `GET /vaults/:id` — only a boolean
`hasRecoveryKey` flag is. It is exposed exclusively through a dedicated,
owner-scoped route, and re-wrapping the password envelope (e.g. during
recovery) never touches the recovery envelope or vice versa
(`vault-recovery.test.ts`).

**HTTP hardening.** Helmet's default security headers, plus a hand-built,
app-specific (not templated) Content-Security-Policy with a per-request
nonce for `script-src` in production, no `unsafe-inline`/`unsafe-eval` in
production, and `frame-ancestors 'none'` (`apps/web/src/lib/security-
headers.ts`, tested in `security-headers.test.ts`).

**Environment validation.** The server refuses to boot if `JWT_SECRET` is
missing, too short, or matches a known placeholder pattern when
`NODE_ENV=production` (`packages/config/src/server-env.ts`).

**Anti-enumeration.** `POST /auth/login` returns the same generic error
for "wrong password" and "no such user."

---

## Dependency security

A `pnpm audit --prod` pass performed as part of this review found 7
vulnerabilities (5 high, 2 moderate), all transitive through `next`'s own
bundled `postcss`/`sharp` versions and postcss's `nanoid` dependency —
none in this project's own code. These were fixed via targeted
`pnpm.overrides` pins (`postcss`, `nanoid`, `sharp`) rather than an
unrelated framework upgrade; `pnpm audit --prod` reports zero known
vulnerabilities as of this review, and the full test/typecheck/build
pipeline was re-run and passes after the change. This was a manual,
point-in-time pass — see the "Known Security Limitations" section of
`SECURITY.md` for what continuous coverage is (and isn't) in place.

---

## Limitations and non-claims

- **This is not a certified or independent audit.** It reflects what one
  reviewer verified by reading the code and running its tests, not a
  professional penetration test or formal threat model.
- **VaultDrop is not claimed to be "production-proof" or immune to
  compromise.** It has known, documented limitations — see `SECURITY.md`'s
  "Known Security Limitations" section (in-memory single-instance rate
  limiting, no session/token revocation, no continuous dependency
  scanning) for the current list.
- **Not full end-to-end encryption of every field.** As stated in the
  README's privacy model, account usernames, vault names, file sizes,
  MIME types, folder structure, and timestamps are server-visible by
  design; only file contents, file/folder names, and key material are
  protected.
- **Client and endpoint security are out of scope.** Nothing in this
  review addresses the security of the user's own device, browser
  extensions, or local malware — client-side encryption protects data in
  transit and at rest on the server, not against a compromised endpoint.
- **No automated browser-based end-to-end test exists yet** covering the
  full register → create vault → upload → download → decrypt path in CI;
  today that flow is covered by unit/integration tests at the API and
  crypto-library level (243 tests total) plus manual verification against
  the live deployment, not a scripted E2E run.
