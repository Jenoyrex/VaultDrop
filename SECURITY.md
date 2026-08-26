# Security Policy

VaultDrop is a personal project built around a zero-knowledge encryption
model: file contents, file/folder names, and every encryption key are
handled client-side, and the server is designed to never receive them in a
usable form. This document explains how to report a security issue, what
to expect, and — just as importantly — what VaultDrop's security model
does *not* cover.

## Reporting a Vulnerability

Please **do not open a public GitHub issue** for a suspected security
vulnerability — that discloses it to everyone before a fix exists.

Instead, report it privately using one of the following:

1. **Preferred:** GitHub's private vulnerability reporting — go to the
   [Security tab of this repository](https://github.com/Jenoyrex/VaultDrop/security)
   and select **"Report a vulnerability"**. This opens a private draft
   security advisory visible only to the maintainer.
2. **Alternative:** email **jenoyrex95@gmail.com** with a clear subject
   line (e.g. `VaultDrop security report: <short description>`).

### What to include in a report

To help triage and reproduce the issue quickly, please include:

- A clear description of the vulnerability and its potential impact.
- Steps to reproduce it (a minimal repro is ideal — e.g. specific
  requests, payloads, or a short script).
- The affected component (frontend, API route, encryption logic, storage
  adapter, etc.) and, if known, the specific file/line.
- Whether the issue requires authentication, a specific role, or specific
  configuration to trigger.
- Your assessment of severity/impact, if you have one — not required, but
  helpful context.

### Responsible disclosure expectations

- This is a personal project maintained by one person, not a company with
  a dedicated security team — please allow reasonable time to respond and
  investigate. A first response should typically arrive within a few days.
- Please give a reasonable window (**90 days** is a common industry
  default) before any public disclosure, to allow time for a fix.
- There is no bug bounty program; this is a portfolio/personal project,
  not a commercial product.
- Please act in good faith: don't access, modify, or exfiltrate data
  beyond what's needed to demonstrate the issue, and don't run automated
  scanning against the live deployed instance in a way that could disrupt
  it for other users.

## Supported Versions

VaultDrop does not yet tag formal, versioned releases (see `CHANGELOG.md`)
— it is developed as a single continuously-deployed line on `main`. Only
the current state of `main` (and the corresponding live deployment) is
supported; there are no maintained older branches.

## Security Model Summary

See the README's "Why VaultDrop / Privacy Model" and "How the Encryption
Flow Works" sections for the full picture. In short: the vault's Data
Encryption Key (DEK) is generated in the browser and only ever leaves the
browser wrapped — once by a password-derived key, and once by a
one-time recovery key — using AES-256-GCM. The server stores ciphertext,
wrapped keys, and KDF parameters; it never receives a usable password,
key-encryption-key, DEK, or recovery key.

**If you lose both your account password and your recovery key, your
encrypted vault data is permanently unrecoverable.** This is a deliberate
consequence of the zero-knowledge design, not an oversight: the server has
no third copy of the DEK and no mechanism to reset a KEK-derived unlock
without one of those two secrets. There is no account-recovery or
support-desk path around this — protecting the recovery key (e.g. storing
it offline) is the user's responsibility.

## Known Security Limitations

Being transparent about current limitations is part of this project's
security posture:

- **No independent third-party audit.** The encryption design and
  authentication/authorization code have been reviewed by the maintainer
  (see `docs/SECURITY_REVIEW.md`) but have not undergone a professional,
  independent security audit. Treat that review as a documented
  self-assessment, not an external certification.
- **Rate limiting is per-process, in-memory.** Auth and API rate limits
  use `express-rate-limit`'s default in-memory store. On a single-instance
  deployment (VaultDrop's current production setup) this enforces the
  documented limits correctly; if the API is ever horizontally scaled to
  multiple instances without a shared store (e.g. Redis), each instance
  would enforce its own independent budget.
- **No session revocation.** Sessions are stateless JWTs with a short
  expiry (15 minutes by default). There is no server-side token blocklist,
  so a compromised token remains valid until it expires; logout is a
  client-side token discard.
- **Server-visible metadata.** Account usernames, vault names, file sizes,
  MIME types, folder structure, and timestamps are not encrypted — only
  file contents, file/folder names, and key material are. See the
  README's privacy model section for the full list of what is and isn't
  protected.
- **Dependency scanning is manual, not continuous.** Production
  dependencies are periodically audited with `pnpm audit`; there is no
  automated, scheduled dependency-vulnerability scan wired into CI yet.

If you find a gap not listed here, please report it using the process
above.
