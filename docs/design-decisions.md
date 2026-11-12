# Design Decisions

Short architecture decision records for VaultDrop's security-relevant
choices. Each one says what was decided, what else was considered, and
what it costs. See [`THREAT_MODEL.md`](./THREAT_MODEL.md) for how these
fit together against specific attackers.

---

## ADR-1: Chunked AES-256-GCM with derived per-chunk nonces

**Context.** Files can be up to `MAX_UPLOAD_BYTES` (100 MiB by default)
and must be encrypted in the browser without holding the whole file in
memory. Web Crypto's AES-GCM is one-shot: it encrypts a whole buffer and
appends one 16-byte tag. AES-GCM fails badly if a (key, nonce) pair is
ever reused: an attacker who sees two ciphertexts under the same pair can
XOR them to cancel the keystream and can forge tags.

**Decision.** Each file gets a fresh random 256-bit key and a random
12-byte base nonce. The plaintext is split into 4 MiB chunks; chunk *i* is
encrypted with nonce = base nonce with its last 4 bytes XORed with *i*
(big-endian), and written as `[4-byte length][ciphertext+tag]`. The base
nonce is prepended to the stream. Code:
`apps/web/src/lib/crypto/chunked-cipher.ts` (`deriveChunkNonce`,
`encryptFileStreamWithEmbeddedNonce`).

**Alternatives.**
- *One AES-GCM call per file:* simplest, but needs the whole file in
  memory, twice (plaintext and ciphertext).
- *Random nonce per chunk:* also safe with a per-file key, but adds 12
  bytes per chunk and a randomness dependency for no gain.
- *A streaming AEAD construction such as STREAM / libsodium
  secretstream:* handles truncation properly (a final-chunk flag), but
  needs a library outside Web Crypto.

**Consequences.**
- Nonces are unique within a file because the counter is unique per chunk
  (up to 2^32 chunks, i.e. 16 PiB), and keys are unique per file, so no
  (key, nonce) pair repeats.
- Reordering chunks fails authentication, because the nonce depends on
  the position.
- **Known gap:** there is no final-chunk flag and no associated data.
  Truncation at a chunk boundary is caught only by comparing the total
  length to the size the server reports (`expectedTotalBytes`), and a
  malicious server can lie about that too. Fixing this means a new
  `encryptionVersion`; the current format must stay readable, so it was
  not changed in this branch.

---

## ADR-2: PBKDF2 in the browser, Argon2id on the server

**Context.** One account password does two jobs: it authenticates the user
to the API, and it derives the KEK that wraps each vault's DEK in the
browser.

**Decision.**
- Server: Argon2id (19 MiB memory, 2 passes, parallelism 1, OWASP's
  minimum) hashes the login password (`packages/crypto/src/password.ts`).
- Browser: PBKDF2-HMAC-SHA256 with 600,000 iterations (OWASP's current
  figure for PBKDF2-SHA256) and a random 16-byte salt per vault derives
  the KEK (`apps/web/src/lib/crypto/kdf.ts`). The iteration count and hash
  are stored per vault, so they can be raised for new vaults without
  breaking old ones.

**Why not Argon2id in the browser.** Web Crypto has no Argon2. It would
need a WebAssembly build, which is a new dependency that sits inside the
encryption trust boundary, has to be loaded under the CSP (which blocks
`wasm-unsafe-eval` today), and is slower and more memory-limited on phones.
PBKDF2 is built into every browser's Web Crypto API, with no extra code
to ship or trust.

**Why not PBKDF2 on the server too.** The server has a native Argon2
binding and no compatibility constraint, so it uses the stronger,
memory-hard function.

**Alternatives.** Argon2id via WASM in the browser; scrypt (also not in
Web Crypto); separate passwords for login and encryption (safer, worse
UX); OPAQUE/aPAKE (server never sees the password, but much more complex).

**Consequences.**
- **The server does see the password at login.** It is the same password
  the KEK comes from, so a server compromised while users log in can
  decrypt their vaults. See the threat model for how to close this
  (derive a separate login secret client-side).
- After a database leak, PBKDF2 is the cheaper target for offline
  guessing: check a guess by deriving the KEK and testing the AES-GCM tag
  of the wrapped DEK. Password strength is the real protection.

---

## ADR-3: Vault keys live only in memory

**Context.** Re-typing the password on every page load is annoying, so it
is tempting to cache the unlocked DEK in `localStorage`, `sessionStorage`
or IndexedDB.

**Decision.** Unlocked DEKs are kept in a `Map` held in a React ref inside
`VaultKeyProvider` (`apps/web/src/components/providers/vault-key-provider.tsx`)
and nowhere else. They disappear on reload, on tab close, on logout, and
when the session expires (the provider calls `lockAll()` when auth status
becomes `unauthenticated`).

**Alternatives.**
- *Persist the raw key:* any XSS, extension or person with disk access
  could read it later, with no password needed.
- *Store a non-extractable `CryptoKey` in IndexedDB:* it cannot be
  exported, but anyone who can run script on the origin can still use it
  to decrypt, and it survives the tab, so a stolen device stays unlocked.

**Consequences.** The user re-enters the password after a reload. A live
XSS can still use the in-memory key (and export it, since keys are
unwrapped as extractable so they can be re-wrapped on password change).
There is no idle auto-lock yet.

---

## ADR-4: Session token in an httpOnly cookie, through a same-origin proxy

**Context.** The JWT used to sit in `localStorage`, readable by any
script on the page. An XSS could copy it and keep using it after the tab
closed. The web app is on Netlify (`*.netlify.app`) and the API on Render
(`*.onrender.com`). Both domains are on the Public Suffix List, so the two
origins are different *sites*: a cookie set by the API is a third-party
cookie from the web app's point of view. Safari blocks those by default,
and Chrome does in some modes.

**Decision.**
1. The API sets the JWT as an httpOnly cookie and never puts it in a
   response body. In production it is `__Host-vaultdrop_session; Secure;
   HttpOnly; SameSite=Lax; Path=/`, with an `Expires` matching the JWT's
   `exp`. The `__Host-` prefix makes the browser reject the cookie unless
   it is Secure, host-only and `Path=/`. Code:
   `apps/server/src/middleware/auth.ts`.
2. **Option (a), a same-origin proxy:** Netlify rewrites `/api/*` to the
   Render API (`apps/web/netlify.toml`), and the web app uses
   `NEXT_PUBLIC_API_URL=/api`. The browser only talks to the Netlify
   origin, so the cookie is first-party and `SameSite=Lax` is enough.
3. CSRF: `SameSite=Lax` stops browsers from attaching the cookie to
   cross-site POST/PUT/PATCH/DELETE requests. As defense in depth, the API
   rejects any state-changing request whose `Origin` (or `Referer`) is not
   `CORS_ORIGIN`, and any cookie-bearing one with neither header
   (`apps/server/src/middleware/origin-check.ts`).
4. Server-side revocation: `User.tokenVersion` is copied into each token's
   `ver` claim and checked on every authenticated request (one
   primary-key lookup). Logout and password change increment it, which
   revokes every outstanding token for that user. Password change then
   issues a new cookie for the device that made the request.
5. Expiry stays short (`JWT_EXPIRES_IN`, 15 minutes by default) with no
   refresh token, as before.

**Alternatives.**
- *(b) Cross-site cookie with `SameSite=None; Secure` plus a double-submit
  CSRF token:* works without a proxy, but Safari (ITP) and Chrome with
  third-party cookies blocked would drop the cookie. Users would be
  logged out on every request with no clear error. Rejected as less
  robust.
- *Next.js `rewrites()` instead of a Netlify redirect:* also same-origin,
  but on Netlify it would run the proxy through the Next.js server
  function, which has request-size and duration limits that large
  encrypted uploads would hit. Netlify's CDN-level proxy avoids the
  function.
- *A custom domain with the API on a subdomain (`api.example.com`):*
  same-site without a proxy, and the cleanest long-term option. It needs
  a domain the project does not have today.
- *Keep the bearer token in memory only:* no XSS persistence, but every
  reload logs the user out.
- *A server-side session table instead of `tokenVersion`:* allows
  per-device logout, but needs a table, cleanup, and a lookup by session
  id. Not needed for a single-user vault app yet.

**Consequences.**
- Page JavaScript can no longer read the token. A live XSS can still make
  requests while the page is open, but cannot carry the session away.
- Every authenticated request costs one extra indexed DB read.
- Logout logs out every device.
- Production depends on the Netlify proxy. Large uploads now pass through
  it, so Netlify's proxy timeouts and body limits apply; check them on the
  live site. Behind the proxy the API sees one more hop, so
  `TRUST_PROXY_HOPS` probably needs to increase (see the PR's deployment
  steps).
- Local development uses `http://localhost:3000` → `http://localhost:4000`.
  Those are the same site, so the `SameSite=Lax` cookie is sent without a
  proxy. In dev the cookie drops `Secure` and the `__Host-` prefix,
  because neither works over plain HTTP in every browser.

---

## ADR-5: Rate limiting

**Context.** Login and register run Argon2id (deliberately slow and
memory-heavy), so they are both a brute-force target and a cheap way to
burn server CPU. Authenticated routes can be abused for scraping or to
fill storage.

**Decision.** `express-rate-limit`, configured in
`apps/server/src/middleware/rate-limit.ts`:
- Register, login, and password change share a per-IP "credential"
  budget (20 per 15 minutes by default). `/auth/check-username` has its
  own stricter per-IP budget (half of that).
- Every `/vaults`, `/folders`, `/files` route shares one per-user budget
  (300 per 5 minutes by default), keyed on the authenticated user id, not
  the IP, so users behind one NAT don't throttle each other. Uploads (30)
  and downloads/previews (60) have extra, tighter per-user budgets on top.
- The client IP comes from Express `trust proxy` set to an explicit hop
  count (`TRUST_PROXY_HOPS`), never `true`, so a client cannot choose its
  own IP by sending `X-Forwarded-For`. Expected production value is 2
  (browser → Netlify → Render load balancer → app), confirmed after deploy
  with the opt-in `/debug/ip` endpoint (`DEBUG_IP_ECHO=1`).
- A per-IP flood ceiling (10x the per-user API budget) runs before
  `requireAuth`, so its database lookup is always behind a limiter.
- In production the API only accepts requests signed by the Netlify proxy
  (`x-nf-sign`, verified against `API_PROXY_SECRET`; `/health` exempt).
  Without this, the public Render URL would be one hop shorter than the
  proxied path, and any hop count right for one path would let callers on
  the other forge their IP.

**Alternatives.** A shared Redis store (correct across instances, but an
extra service); limiting at the CDN/WAF (not portable); per-IP limits
everywhere (punishes shared IPs).

**Alternatives for the proxy bypass.** Accept that direct callers can
spoof (simplest, but leaves the login limiter bypassable); restrict
Render to Netlify's IP ranges (not published as a stable list); key
limits on Netlify's `x-nf-client-connection-ip` (spoofable on direct
requests without the signature check anyway).

**Consequences.** Limits are per process. With one Render instance they
are exact; with several, each enforces its own budget. A wrong
`TRUST_PROXY_HOPS` either lumps all users under the proxy's IP or lets
clients spoof theirs. The API is no longer usable except through the web
app's `/api` proxy in production, and `API_PROXY_SECRET` must match on
Netlify and Render or every request fails with 403.

---

## ADR-6: Content-Security-Policy with per-request nonces

**Context.** Client-side encryption is only as safe as the JavaScript on
the page. XSS is the main way to get attacker script onto the page.

**Decision.** `apps/web/src/middleware.ts` generates a random nonce per
request and sets a CSP built by `apps/web/src/lib/security-headers.ts`.
In production: `script-src 'self' 'nonce-…'` (no `unsafe-inline`, no
`unsafe-eval`), `style-src 'self'`, `style-src-attr 'unsafe-inline'`
(Radix/Framer Motion set inline style attributes, which cannot run
script), `connect-src 'self'` (plus the API origin only when it is not
proxied), `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
`form-action 'self'`. Next.js reads the nonce from the request header and
applies it to its own inline bootstrap script. Static headers (HSTS,
`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
`Permissions-Policy`) are in `apps/web/next.config.mjs`.

**Alternatives.** Hash-based CSP (breaks whenever Next changes its inline
script); `unsafe-inline` (defeats the purpose); a static CSP from
`next.config` (cannot carry a per-request nonce).

**Consequences.** Every page is rendered dynamically, because the nonce
changes per request, so pages are not statically cached. Development
allows `unsafe-eval` for Fast Refresh. A CSP does not protect against a
malicious server, which controls the CSP too.

---

## ADR-7: Per-request database check for token revocation

**Context.** ADR-4 makes tokens revocable by comparing the token's `ver`
claim with `User.tokenVersion`. That comparison has to read the current
value from somewhere on every authenticated request.

**Decision.** Read it from PostgreSQL on every request: one primary-key
lookup selecting a single integer column (`createAuthMiddleware` in
`apps/server/src/middleware/auth.ts`). No cache.

**Cost.** One extra round trip to Neon per authenticated request, on top of
the queries the route already makes. It is an indexed point read of one
column, so the cost is dominated by network latency to the database
(typically a few milliseconds from the same region), not query work. The
per-IP flood limiter (ADR-5) runs before it, so the lookup cannot be
driven unthrottled. At this project's traffic the cost is negligible; it
would matter at thousands of requests per second, or with a database far
from the API.

**Alternatives.**
- *Short-lived cache of `tokenVersion` per user (30–60 s)*, in process
  memory for one instance or in Redis for several. This removes most
  lookups. **Trade-off:** a revoked token keeps working until the cache
  entry expires, so "logout revokes immediately" becomes "logout revokes
  within the TTL". An in-memory cache also does not see revocations made
  on another instance, so with several instances it needs Redis, or a
  pub/sub invalidation message on logout/password change.
- *No revocation, rely on the 15-minute expiry:* no lookup, but a stolen
  token stays valid until it expires (the previous behavior).
- *A denylist of revoked token ids:* lookups only hit a small set, but it
  is still a per-request read and needs cleanup of expired entries.

**Consequences.** Revocation is immediate and correct across any number of
instances, at the cost of one indexed read per request. Revisit with the
cache option, and accept the TTL window, only if profiling shows this
lookup matters.
