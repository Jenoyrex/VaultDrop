# VaultDrop — NEXT_STEPS

This is the proposed Sprint 3 plan. **Do not start any of this without
explicit go-ahead from the project owner** — Sprint 2 was deliberately
closed out with a documentation checkpoint before proceeding, and that
pattern should repeat: implement → typecheck → build → fix → document →
stop → wait for review.

## 0. Decision needed before Sprint 3 can start cleanly

**The User↔Vault gap (see `PROJECT_STATE.md` Known Issue #1) should be
resolved first**, because every folder/file endpoint requires a real
`vaultId`, and right now sign-up never creates one. Pick one:

- **(a) Auto-create a default Vault server-side at registration.**
  Smallest change: inside `AuthService.register`, after creating the
  `User`, also create one `Vault` (e.g. named `"My Vault"` or
  `${username}'s Vault`) and consider returning its id in the
  `AuthResponse` (would require a small, additive change to
  `packages/types`'s `AuthResponse` — flag this clearly if it's the
  chosen path, since `packages/types` has been frozen).
- **(b) Frontend calls `POST /vaults` right after a successful
  register.** No backend change at all; the create-vault page would call
  `register()` then immediately `POST /vaults` with a default name. Keeps
  backend frozen, adds one more network round-trip and a brief window
  where a user exists without a vault.
- **(c) Schema change to make Vault implicit/1:1 with User.** Most
  invasive — touches `prisma/schema.prisma`, which has been explicitly
  frozen since Sprint 1. Only do this if explicitly directed to revisit
  the data model.

Recommendation if asked: **(a)**, since it keeps the invariant "every
user has a vault" enforced server-side and only adds one Vault-creation
call inside an already-existing transaction-like flow, rather than
depending on the frontend to always remember to call a second endpoint.
But this is a product/architecture decision, not a purely technical one —
surface the tradeoff and let the project owner choose rather than picking
silently.

## 1. Sprint 3 candidate objectives — Folder & File UI

Assuming the Vault question above is resolved first:

1. **Folder browser page** (likely `/dashboard` itself, replacing the
   current empty state, or a nested route like `/dashboard/vault`).
   - Breadcrumb trail reflecting the current folder path.
   - Grid or list view of subfolders and files
     (`GET /folders/contents?vaultId&folderId?`).
   - "New Folder" action (`POST /folders`).
   - Rename / move / delete actions on folders (`PATCH` / `DELETE
     /folders/:folderId`) — moving likely needs a folder picker.
2. **File upload UI.**
   - Drag-and-drop zone + a manual file picker fallback.
   - Progress indication (the backend doesn't currently stream upload
     progress events; consider whether that's worth a backend addition
     or whether an indeterminate spinner is acceptable for this sprint).
   - Respect `MAX_UPLOAD_BYTES` client-side before attempting upload, to
     fail fast with a friendly message instead of waiting for a 413/500
     from multer.
   - Calls `POST /files/upload` with `vaultId`/`folderId?` query params
     and a multipart `file` field.
3. **File list UI** within a folder — name, icon-by-mime-type, size
   (human-readable), modified date, and per-row actions (download,
   preview, delete).
4. **File download** — trigger `GET /files/:fileId/download` (a plain
   anchor `href` with the bearer token is awkward since browsers can't
   send custom headers on a navigation; likely needs either a signed/
   short-lived URL pattern added to the backend, or a fetch-then-
   `URL.createObjectURL` blob-download approach client-side — **decide
   this explicitly, it's a real design choice**, not a default to assume
   silently).
5. **File preview** — for `image/*`, render inline; for `application/pdf`,
   use the browser's native PDF viewer in an iframe or a dedicated
   viewer library; for `text/*`/`application/json`, fetch and render as
   text; for `audio/*`/`video/*`, use native `<audio>`/`<video>` tags.
   Must respect the backend's 415 response for anything outside that
   allowlist (show a "can't preview this file type, download instead"
   state, don't error ugly).
6. **Wire up the Sidebar's "Folders" item** to actually navigate, once
   there's somewhere for it to go (it currently shows a "Soon" badge).

## 2. Things explicitly NOT in scope for Sprint 3 unless told otherwise

(Mirroring the same kind of explicit exclusion list Sprint 2 was given,
so a future session doesn't over-reach):
- Settings page / account management.
- Sharing (sharing a vault, a folder, or a file with another user) — note
  the backend doesn't have any sharing data model yet either; this would
  be a significant addition to `prisma/schema.prisma` if ever requested.
- Admin / multi-tenant features.
- Dark mode toggle UI (tokens exist, wiring a toggle is small but still
  not requested yet).
- Automated tests / CI — valuable, but should probably be its own
  explicitly-scoped sprint rather than folded silently into UI work.

## 3. Process reminders for whoever runs Sprint 3

- Keep treating `apps/server`, `packages/crypto`, `packages/config`,
  `packages/types`, `packages/ui`, and `prisma` as frozen **unless** a
  genuine integration blocker is discovered (the same bar that justified
  adding `GET /auth/check-username` in Sprint 2 — read `HANDOFF.md` §3
  for what that bar looks like in practice). If Sprint 3 needs a backend
  change (e.g. for the Vault auto-creation decision in §0, or for a
  download URL pattern in §1.4), call it out explicitly and explain why,
  the same way it was done for `check-username`, rather than assuming
  silent permission.
- After finishing each feature: typecheck → build → fix → only then move
  on. Never leave compile errors behind.
- Stop at a clean, fully-compiling boundary and regenerate the
  documentation package (all 5 files + the continuation prompt) before
  starting a new sprint, exactly as was done here.
- Don't redesign anything already marked COMPLETE without flagging it
  first — if something genuinely needs to change, explain the tradeoff
  and ask, don't just change it.
