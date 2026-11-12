# Threat Model

Scope: the code in this repository as of the `security/session-hardening`
branch. This document is a self-assessment written by the maintainer. It
is not an external audit. Paths point to the control that does the work.

## System in one paragraph

The browser (Next.js on Netlify) derives a key-encryption key (KEK) from
the account password with PBKDF2-SHA256 (600,000 iterations), unwraps a
random per-vault data key (DEK), and uses it to wrap a random per-file key
and to encrypt file/folder names. File contents are encrypted in 4 MiB
AES-256-GCM chunks with the per-file key. The API (Express on Render)
stores ciphertext in Backblaze B2 and metadata plus wrapped keys in
PostgreSQL (Neon). The login password is sent to the API, which verifies
it against an Argon2id hash. Sessions are JWTs in an httpOnly cookie.

## Assets

| Asset | Where it lives | Protection |
|---|---|---|
| File contents | B2, as chunked AES-256-GCM ciphertext | Per-file key, wrapped by the vault DEK (`apps/web/src/lib/upload/encrypt-upload.ts`, `apps/web/src/lib/crypto/chunked-cipher.ts`) |
| File and folder names | PostgreSQL, as AES-GCM ciphertext | Encrypted with the vault DEK (`apps/web/src/lib/crypto/text-cipher.ts`) |
| Vault DEK | Browser memory only while unlocked; DB stores it wrapped twice (KEK, recovery key) | `apps/web/src/components/providers/vault-key-provider.tsx`, `apps/web/src/lib/vault-keys.ts` |
| Login password | Typed in the browser; sent over TLS at login, register, password change, and the vault-creation/restore password checks | Argon2id hash at rest (`packages/crypto/src/password.ts`); never logged (`apps/server/src/middleware/request-logger.ts`) |
| Recovery key | Shown once; the user stores it offline | 256-bit random (`apps/web/src/lib/crypto/recovery-key.ts`); never sent to the server |
| Session token | httpOnly cookie | `apps/server/src/middleware/auth.ts` |
| Account metadata | PostgreSQL | Not encrypted (see "What the server can see") |

## What the server can see

Stated plainly, the API operator (or anyone who compromises the API
process, the database, or the storage bucket) can see:

- **Account identifiers:** usernames, user ids, account creation time.
- **The login password, at login time.** It arrives over TLS in the request
  body. It is hashed and not stored or logged, but code running on the
  server could capture it. **The KEK is derived from this same password**,
  so whoever captures it can derive the KEK and decrypt that user's vaults.
- **Vault names** (plaintext), folder structure (parent/child links), and the
  number of vaults, folders, and files.
- **Ciphertext sizes**, and from them approximate plaintext sizes: each 4 MiB
  chunk adds 20 bytes (4-byte length + 16-byte tag), plus a 12-byte nonce
  per file, so the plaintext size is recoverable to within a few bytes.
- **MIME types** of files (sent as plaintext metadata on upload).
- **Timestamps:** creation/update times, and upload/download times from
  request timing.
- **IP addresses and user agents** (at the hosting layer, Netlify and
  Render; the app's own request log records only method, path, status
  and duration), and **access patterns**: which file ids a user downloads,
  when, and how often.
- **Legacy vaults** created before encryption became mandatory are stored
  in plaintext.

### The core limit of browser-based end-to-end encryption

**A malicious or compromised server can serve modified JavaScript.** The
code that derives keys and encrypts files is downloaded from the same
operator who stores the ciphertext. A modified bundle could send the
password, the DEK, or plaintext files anywhere. Nothing in this repository
prevents that: CSP, SRI and HTTPS all trust the origin that serves them.
Every guarantee below holds only while the served JavaScript is the code in
this repository.

## Adversaries

### 1. Curious or compromised server / database operator

- **Can:** read all metadata listed above; capture the login password when
  a user logs in and use it to derive the KEK and decrypt that user's
  vaults; serve modified JavaScript; delete, withhold, or roll back files;
  swap ciphertexts or encrypted names between files in the same vault (no
  associated data binds a name or key to a file id); truncate a file at a
  chunk boundary and report a matching size (chunks have no "final chunk"
  marker, so `expectedTotalBytes` in `chunked-cipher.ts` only catches
  truncation the server does not also lie about).
- **Cannot (if it only reads stored data and does not act during a login):**
  decrypt file contents or names. The DB holds only wrapped keys, KDF
  parameters and an Argon2id hash.
- **Controls:** client-side encryption (`apps/web/src/lib/crypto/`),
  per-file keys, AES-GCM authentication of every chunk and name.

### 2. Database leak (dump of PostgreSQL)

- **Can:** read metadata; run offline password guessing. Two routes exist:
  against the Argon2id hash (19 MiB, t=2), and against a vault's wrapped
  DEK, by trying PBKDF2-SHA256(600k) for each guess and checking the
  AES-GCM tag. **The PBKDF2 route is the cheaper one per guess on GPUs**,
  so a weak password is the real exposure.
- **Cannot:** decrypt anything for a user with a strong password; use the
  recovery-wrapped DEK (the recovery key is 256 random bits); forge
  sessions (the JWT signing secret is an environment variable, not in
  the DB).
- **Controls:** Argon2id (`packages/crypto/src/password.ts`), PBKDF2 600k
  (`apps/web/src/lib/crypto/kdf.ts`), password-strength feedback
  (`apps/web/src/components/auth/password-strength.tsx`).

### 3. Network attacker

- **Can:** observe that a user talks to the site, plus traffic timing and
  volume (which reveals approximate file sizes).
- **Cannot:** read or modify traffic protected by TLS; strip TLS on the web
  origin once HSTS is cached (set in production, `apps/web/next.config.mjs`).
  The Netlify-to-Render proxy hop is also HTTPS (`apps/web/netlify.toml`).
- **Controls:** HTTPS, HSTS, `Secure` + `__Host-` cookie in production.

### 4. XSS in the web app

- **Can (if it runs):** do anything the page can do while it is open: read
  decrypted names and previews, capture the password as it is typed, make
  authenticated API requests (the browser attaches the cookie), and export
  an unlocked DEK (unwrapped keys are `extractable: true` in
  `apps/web/src/lib/crypto/key-wrap.ts`, which password-change re-wrapping
  needs).
- **Cannot:** read the session token. It is an httpOnly cookie
  (`apps/server/src/middleware/auth.ts`), so it cannot be exfiltrated and
  reused after the tab closes, which was possible when it lived in
  localStorage. Logout revokes it server-side either way.
- **Controls:** React output escaping; a nonce-based CSP with no
  `unsafe-inline`/`unsafe-eval` in production `script-src`
  (`apps/web/src/middleware.ts`, `apps/web/src/lib/security-headers.ts`);
  `connect-src 'self'` limits where injected script can send data with
  `fetch` (it does not stop navigation-based exfiltration).

### 5. Malicious browser extension

- **Can:** everything XSS can, without being limited by CSP. An extension
  with access to the site sees the password, keys in memory, and plaintext.
- **Cannot be stopped by this app.** Out of scope; the user's browser is
  part of the trusted computing base.

### 6. Stolen device, browser still unlocked

- **Can:** while a vault is unlocked in an open tab, read all its files.
  With the tab closed but the session cookie not yet expired (up to the
  JWT lifetime, 15 minutes by default), call the API as the user, but
  only to see ciphertext and metadata. Opening a vault needs the password
  again, because DEKs are memory-only and lost on reload.
- **Controls:** memory-only DEKs, cleared on logout or session expiry
  (`vault-key-provider.tsx`); short JWT expiry; logout and password change
  revoke all sessions (`tokenVersion`, `apps/server/src/routes/auth.routes.ts`).
- **Gap:** there is no idle auto-lock for unlocked vaults.

### 7. B2 bucket exposure (keys leaked or bucket made public)

- **Can:** download ciphertext objects, learn sizes and object count per
  vault (keys are `<vaultId>/<random uuid>`, see
  `apps/server/src/routes/file.routes.ts`); delete or overwrite objects.
- **Cannot:** decrypt them. Per-file keys are only in the DB, wrapped by a
  DEK that needs the user's password. Plaintext names are never part of the
  object key for encrypted files.
- **Controls:** client-side encryption; storage keys without names.

### 8. Cross-site request forgery and session theft over the network

- **Controls:** `SameSite=Lax` cookie, plus an Origin/Referer check that
  rejects state-changing requests from any origin other than `CORS_ORIGIN`
  (`apps/server/src/middleware/origin-check.ts`); CORS allows exactly one
  origin with credentials (`apps/server/src/app.ts`).

### 9. Online password guessing and enumeration

- **Controls:** per-IP limits on register/login and a stricter one on
  username checks; per-user limits on the rest of the API
  (`apps/server/src/middleware/rate-limit.ts`); generic login errors.
- **Limits:** limits are in memory, per process. `/auth/check-username`
  deliberately reveals whether a username exists (the sign-in flow needs
  it), so enumeration is rate-limited, not prevented. Behind proxies the
  client IP is only correct if `TRUST_PROXY_HOPS` matches the real hop
  count.

## Out of scope and known limitations

| Limitation | What would close it |
|---|---|
| Server-served JavaScript can be malicious | Distribute the client outside the server's control (signed browser extension or native app), or publish reproducible builds with a transparency log that users can verify. |
| Same password for login and KEK | Derive a separate login secret in the browser (e.g. HKDF of the PBKDF2 output with an "auth" label) and send only that, or use an aPAKE such as OPAQUE. The KEK path can stay as is, so existing ciphertext keeps working; login hashes would migrate on next login. |
| PBKDF2 is the cheaper offline-guessing target | Use a memory-hard KDF (Argon2id via WebAssembly) in the browser for new vaults under a new `encryptionVersion`. |
| No binding of names/keys/chunks to file ids, no final-chunk marker | Add AES-GCM associated data (file id, chunk index, last-chunk flag) under a new `encryptionVersion`. Old files keep decrypting with version 1. |
| Metadata in plaintext (vault names, MIME types, sizes, structure, timestamps) | Encrypt vault names and MIME types with the DEK; pad file sizes to buckets. Structure and timing cannot be hidden from a server that stores the files. |
| Revocation is per user, not per device | A server-side session table keyed by a random session id. |
| Rate limits are per process | A shared store (e.g. Redis) for `express-rate-limit`. |
| Unlocked DEKs are extractable and stay unlocked while the tab is open | Re-import DEKs as non-extractable except during a password change, and add an idle auto-lock. |
| No second factor | TOTP or WebAuthn on login. (It would not protect the vault itself, whose security rests on the password.) |
| Legacy plaintext vaults | A client-side migration that re-uploads their files encrypted. |
