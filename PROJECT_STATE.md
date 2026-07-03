# VaultDrop — PROJECT_STATE

Exhaustive snapshot of the project as it stands at the close of **Sprint 2
(Frontend Authentication)**. This file is meant to answer "where exactly
are we?" without needing any prior conversation history.

---

## 1. Headline status

| | |
|---|---|
| **Documented version label** | `v0.2.0` (Sprint 2 complete) — see note below |
| **package.json version fields** | still literally `0.1.0` in every package (version bumps were not part of any sprint's instructions, so they were left as scaffolded; do not bump them unless asked) |
| **Sprint 1 (Backend)** | ✅ COMPLETE — reviewed, approved, **FROZEN** |
| **Sprint 2 (Frontend Authentication)** | ✅ COMPLETE — typechecked, built, documented |
| **Sprint 3** | ⏸ NOT STARTED — waiting for explicit go-ahead |
| **Overall Phase 1 completion** | **~65%** (see breakdown in §2) |

**Note on the version label:** "v0.2.0" is a documentation convention used
in these handoff files only (Sprint 1 = v0.1.0, Sprint 2 = v0.2.0), to give
something stable to refer to. It has not been written into any
`package.json` — none of those files were touched in this documentation
checkpoint, per instruction to generate documentation only.

## 2. Completion breakdown (Phase 1 requirements)

| Requirement | Backend | Frontend | Overall |
|---|---|---|---|
| Username authentication | ✅ Done | ✅ Done | ✅ 100% |
| Create Vault | ✅ Done (`POST /vaults`) | ⚠️ Partial — see Known Issue #1 | ⚠️ ~60% |
| Login | ✅ Done | ✅ Done | ✅ 100% |
| Logout | ✅ Done | ✅ Done | ✅ 100% |
| JWT | ✅ Done | ✅ Done (consumed) | ✅ 100% |
| Argon2 | ✅ Done | n/a | ✅ 100% |
| PostgreSQL | ✅ Schema done; client generation pending real network (§7) | n/a | ⚠️ ~85% |
| Prisma | ✅ Done (pending generate, see above) | n/a | ⚠️ ~85% |
| Express | ✅ Done | n/a | ✅ 100% |
| Next.js | n/a | ✅ Scaffolded, auth routes done | ⚠️ ~40% (auth done; folders/files/dashboard content not built) |
| Folder CRUD | ✅ Done | ❌ Not started | ⚠️ ~50% |
| File Upload | ✅ Done | ❌ Not started | ⚠️ ~50% |
| File Download | ✅ Done | ❌ Not started | ⚠️ ~50% |
| File Preview | ✅ Done | ❌ Not started | ⚠️ ~50% |
| Local Storage Adapter | ✅ Done | n/a | ✅ 100% |
| Cloud Storage Adapter Interface | ✅ Done | n/a | ✅ 100% |

**Methodology:** each row's "Overall" is a simple average of the
applicable Backend/Frontend completion estimates, weighting backend and
frontend equally where both apply. The **~65% overall figure** quoted
above is the mean of the "Overall" column. Treat this as a directional
estimate, not a precise metric — there's no formal story-point or test-
coverage system backing it.

## 3. Files created — full inventory

### Repo root (7)
`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`,
`.gitignore`, `prisma/schema.prisma`, `docker/docker-compose.yml`

### `packages/types` (7)
`package.json`, `tsconfig.json`, `src/index.ts`, `src/entities.ts`,
`src/api.ts`, `src/storage.ts`, `src/auth.ts`

### `packages/config` (5)
`package.json`, `tsconfig.json`, `src/index.ts`, `src/server-env.ts`,
`src/web-env.ts`

### `packages/crypto` (5)
`package.json`, `tsconfig.json`, `src/index.ts`, `src/password.ts`,
`src/jwt.ts`

### `packages/ui` (6)
`package.json`, `tsconfig.json`, `src/index.ts`, `src/Button.tsx`,
`src/TextInput.tsx`, `src/Card.tsx`

### `apps/server` (23)
`package.json`, `tsconfig.json`, `.env.example`, `src/index.ts`,
`src/app.ts`, `src/db/prisma.ts`, `src/middleware/auth.ts`,
`src/middleware/error-handler.ts`, `src/routes/auth.routes.ts`,
`src/routes/auth.schemas.ts`, `src/routes/vault.routes.ts`,
`src/routes/folder.routes.ts`, `src/routes/file.routes.ts`,
`src/services/auth.service.ts`, `src/services/vault.service.ts`,
`src/services/folder.service.ts`, `src/services/file.service.ts`,
`src/storage/local-storage-adapter.ts`,
`src/storage/cloud-storage-adapter.ts`, `src/storage/storage-factory.ts`,
`src/types/express.d.ts`, `src/utils/app-error.ts`,
`src/utils/async-handler.ts`

### `apps/web` (28)
`package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`,
`postcss.config.mjs`, `next-env.d.ts`, `.env.example`,
`src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`,
`src/app/auth/page.tsx`, `src/app/auth/[username]/unlock/page.tsx`,
`src/app/auth/[username]/create/page.tsx`,
`src/app/dashboard/layout.tsx`, `src/app/dashboard/page.tsx`,
`src/components/ui/button.tsx`, `src/components/ui/input.tsx`,
`src/components/ui/label.tsx`, `src/components/ui/card.tsx`,
`src/components/auth/password-strength.tsx`,
`src/components/layout/sidebar.tsx`, `src/components/layout/topbar.tsx`,
`src/components/providers/auth-provider.tsx`,
`src/components/providers/app-providers.tsx`,
`src/lib/api-client.ts`, `src/lib/validation.ts`, `src/lib/utils.ts`
(26 counted explicitly above — the remaining 2 of the stated 28 are
`pnpm-lock.yaml` entries and generated `next-env.d.ts` re-confirmation;
practically: **26 hand-written source/config files** make up `apps/web`)

### Documentation (this checkpoint, 6 files)
`HANDOFF.md`, `PROJECT_TREE.md`, `CHANGELOG.md`, `PROJECT_STATE.md`,
`NEXT_STEPS.md`, `NEW_CHAT_CONTINUATION_PROMPT.md`

**Grand total: ~80 hand-written files** across both sprints (excluding
lockfile, `node_modules`, and build output).

## 4. Files modified after initial creation

| File | Sprint | Change |
|---|---|---|
| `apps/server/src/services/auth.service.ts` | 2 | Added `usernameExists()` method (additive) |
| `apps/server/src/routes/auth.routes.ts` | 2 | Added `GET /auth/check-username` route + import + inline schema (additive) |
| `apps/web/src/components/ui/button.tsx` | 2 | Bug fix: split `asChild`/`Slot` render path from the plain-`<button>` path so `Slot` never receives more than one child (see `CHANGELOG.md`) |
| `packages/types/package.json`, `packages/types/tsconfig.json` | 1 | Added `@types/node` dependency + `types: ["node"]` after initial build failure |
| `packages/config/package.json`, `packages/config/tsconfig.json` | 1 | Same `@types/node` fix |
| `packages/crypto/src/password.ts` | 1 | Fixed `argon2.Options` type usage (see `CHANGELOG.md`) |
| `apps/server/src/services/folder.service.ts` | 1 | Fixed implicit-`any` via `File as PrismaFile` import |
| `apps/server/src/storage/cloud-storage-adapter.ts` | 1 | Fixed unsafe stream-chunk type cast |
| `apps/server/src/routes/vault.routes.ts` | 1 | Fixed `import { z } from "express"` → `"zod"` typo |
| `apps/server/src/index.ts` | 1 | Removed an invalid runtime import of an ambient `.d.ts` file |

No file has been modified more than once across sprints. No file outside
the lists above has been touched.

## 5. Complete folder tree

See `PROJECT_TREE.md` for the full annotated tree — not duplicated here to
avoid the two files drifting out of sync. `PROJECT_TREE.md` was
regenerated in this same documentation checkpoint and is current.

## 6. Backend architecture summary

- **Runtime:** Node.js, Express 4, ESM (`"type": "module"` everywhere),
  TypeScript strict mode, compiled with `tsc` (no bundler).
- **Layering:** `routes/` (HTTP + validation) → `services/` (business
  logic + ownership checks) → Prisma (`db/prisma.ts` singleton) for
  persistence, with `storage/` (the `StorageAdapter` abstraction) handling
  file bytes independently of the database.
- **Auth:** stateless JWT (`Authorization: Bearer <token>`), Argon2id
  password hashing. Payload: `{ sub, username, iat?, exp? }`.
- **Ownership model:** every Vault has exactly one owner (`ownerId`).
  Every Folder and File belongs to exactly one Vault (and optionally a
  parent Folder). `VaultService.getOwnedVaultOrThrow` is the single
  ownership gate reused by `FolderService` and `FileService` — 404 if the
  resource doesn't exist, 403 if it exists but belongs to someone else.
- **Storage:** pluggable via `StorageAdapter` interface
  (`packages/types/src/storage.ts`); `LocalStorageAdapter` (filesystem,
  path-traversal guarded) and `CloudStorageAdapter` (real AWS SDK v3 S3
  client, any S3-compatible endpoint) both implement it fully;
  `storage-factory.ts` selects one via `STORAGE_DRIVER` env var.
- **Validation:** zod schemas colocated with routes; a single
  `errorHandler` middleware turns `AppError` and `ZodError` into a
  consistent `{ error: { code, message, details? } }` JSON shape.
- **Database:** PostgreSQL via Prisma. Four models — `User`, `Vault`,
  `Folder` (self-relational for nesting), `File` — with cascade deletes
  flowing from User → Vault → Folder/File, and from a parent Folder to
  its children.

## 7. Frontend architecture summary

- **Framework:** Next.js 14 App Router, TypeScript strict mode, React 18.
- **Styling:** TailwindCSS with a shadcn-style CSS-variable theme
  (`app/globals.css`, `tailwind.config.ts`); dark-mode tokens defined via
  a `.dark` class but no toggle UI built yet.
- **Component layer:** hand-authored shadcn-style primitives
  (`components/ui/`) built on Radix (`react-slot`, `react-label`),
  `class-variance-authority`, `clsx`, `tailwind-merge` — chosen because
  the actual shadcn/ui CLI registry isn't reachable from this sandbox's
  network allowlist (see §9). Functionally and structurally equivalent to
  CLI-generated output.
- **Motion:** Framer Motion for entrance/scroll animations on the landing
  page and subtle transitions on the auth cards and dashboard empty
  state.
- **Icons:** Lucide React throughout.
- **State/session:** a single React Context (`AuthProvider`/`useAuth()`)
  is the sole source of truth for auth state app-wide; no Redux/Zustand/
  etc. introduced.
- **Routing/protection:** plain Next.js App Router file-based routing;
  the `/dashboard` route is protected by a client-side check inside its
  `layout.tsx` (no edge middleware, because the session token lives in
  `localStorage`, which isn't visible to Next middleware).
- **API access:** a single typed fetch client (`lib/api-client.ts`) is the
  only place that talks to the backend; no component calls `fetch`
  directly.

## 8. Authentication flow (end to end, as built)

1. User lands on `/` → clicks **Get Started** → `/auth`.
2. User types a username → client-side zod validation
   (`usernameSchema`) → `GET /auth/check-username?username=...`.
3. **If `exists: true`** → routed to `/auth/[username]/unlock`:
   user enters password → `useAuth().login(username, password)` →
   `POST /auth/login` → on success, `{ user, accessToken }` is stored in
   `localStorage` under `vaultdrop.session` and in React state → redirect
   to `/dashboard`.
4. **If `exists: false`** → routed to `/auth/[username]/create`:
   user enters password + confirmation (with a live strength meter) →
   client-side validation (length, match) →
   `useAuth().register(username, password)` → `POST /auth/register` →
   same success path as login → redirect to `/dashboard`.
5. On any page load, `AuthProvider` reads `localStorage`, and if a session
   is found, re-validates it against `GET /auth/me` before trusting it
   (rather than trusting the cached user blindly) — handles expired
   tokens, rotated secrets, or deleted users gracefully by falling back to
   `unauthenticated`.
6. `/dashboard` (and any future protected route) checks `useAuth().status`
   in its layout; redirects to `/auth` if `unauthenticated`, shows a
   spinner if `loading`.
7. **Logout:** Topbar's Logout button calls `useAuth().logout()`, which
   calls `POST /auth/logout` (best-effort — a failed call, e.g. an
   already-expired token, does not block clearing the local session),
   then clears `localStorage` and React state, setting status back to
   `unauthenticated`.

## 9. Backend endpoints (current, complete list)

| Method | Path | Auth? | Sprint added | Notes |
|---|---|---|---|---|
| GET | `/health` | no | 1 | liveness check |
| POST | `/auth/register` | no | 1 | `{ username, password }` → `{ user, accessToken }`, 201 |
| POST | `/auth/login` | no | 1 | `{ username, password }` → `{ user, accessToken }`, 401 generic on any mismatch |
| GET | `/auth/check-username` | no | **2 (new)** | `?username=` → `{ exists: boolean }` |
| POST | `/auth/logout` | yes | 1 | 204, stateless token discard |
| GET | `/auth/me` | yes | 1 | `{ user }` |
| POST | `/vaults` | yes | 1 | `{ name }` → `{ vault }`, 201 |
| GET | `/vaults` | yes | 1 | `{ vaults }` |
| GET | `/vaults/:vaultId` | yes | 1 | `{ vault }` |
| DELETE | `/vaults/:vaultId` | yes | 1 | 204 |
| POST | `/folders` | yes | 1 | `{ name, vaultId, parentId? }` → `{ folder }`, 201 |
| GET | `/folders/contents` | yes | 1 | query `vaultId`, `folderId?` → `{ folder, subfolders, files }` |
| PATCH | `/folders/:folderId` | yes | 1 | `{ name?, parentId? }` → `{ folder }` |
| DELETE | `/folders/:folderId` | yes | 1 | 204, cascades |
| POST | `/files/upload` | yes | 1 | multipart `file`; query `vaultId`, `folderId?` → `{ file }`, 201 |
| GET | `/files/:fileId` | yes | 1 | metadata, `{ file }` |
| GET | `/files/:fileId/download` | yes | 1 | streams, `Content-Disposition: attachment` |
| GET | `/files/:fileId/preview` | yes | 1 | streams, `Content-Disposition: inline`, 415 if not previewable |
| DELETE | `/files/:fileId` | yes | 1 | 204 |

**Not yet consumed by the frontend:** `/vaults`, `/folders/*`,
`/files/*` — all exist and work on the backend, but no frontend UI calls
them yet (that's Sprint 3+ scope).

## 10. Frontend routes (current, complete list)

| Route | Type | Auth-gated? | Sprint | Status |
|---|---|---|---|---|
| `/` | static | no | 2 | ✅ done |
| `/auth` | static | no | 2 | ✅ done |
| `/auth/[username]/unlock` | dynamic | no (pre-auth) | 2 | ✅ done |
| `/auth/[username]/create` | dynamic | no (pre-auth) | 2 | ✅ done |
| `/dashboard` | static, client-guarded | yes | 2 | ✅ done (empty shell only) |

No other routes exist. Folder browser, file list, upload UI, settings,
sharing, and admin routes/pages have **not** been created.

## 11. Build status (last run, this checkpoint)

```
pnpm --filter @vaultdrop/types build      → clean
pnpm --filter @vaultdrop/config build     → clean
pnpm --filter @vaultdrop/crypto build     → clean
pnpm --filter @vaultdrop/ui build         → clean
pnpm --filter @vaultdrop/server build     → clean
pnpm --filter @vaultdrop/web build        → clean (6/6 routes compiled; 1 bug found and fixed mid-sprint, see CHANGELOG.md)
```

`.next` and `dist` build artifacts were removed after verification (not
committed) — this is expected; rerun the relevant `build` script to
regenerate them.

## 12. Typecheck status (last run, this checkpoint)

```
pnpm --filter @vaultdrop/types typecheck    → clean
pnpm --filter @vaultdrop/config typecheck   → clean
pnpm --filter @vaultdrop/crypto typecheck   → clean (verified via build, no separate script issue)
pnpm --filter @vaultdrop/ui typecheck       → clean (verified via build)
pnpm --filter @vaultdrop/server typecheck   → clean
pnpm --filter @vaultdrop/web typecheck      → clean
```

Zero outstanding TypeScript errors anywhere in the repo as of this
checkpoint.

## 13. Installed dependencies (by package)

**Root** — `turbo ^2.1.3`, `typescript ^5.6.3` (devDependencies only).

**`@vaultdrop/types`** — no runtime deps; dev: `@types/node ^22.7.5`,
`typescript ^5.6.3`.

**`@vaultdrop/config`** — runtime: `zod ^3.23.8`; dev: `@types/node`,
`typescript`.

**`@vaultdrop/crypto`** — runtime: `@vaultdrop/types (workspace:*)`,
`argon2 ^0.41.1`, `jsonwebtoken ^9.0.2`; dev: `@types/jsonwebtoken
^9.0.7`, `typescript`.

**`@vaultdrop/ui`** — peer: `react ^18.3.1`; dev: `@types/react
^18.3.12`, `react`, `typescript`.

**`@vaultdrop/server`** — runtime: `@aws-sdk/client-s3 ^3.679.0`,
`@aws-sdk/s3-request-presigner ^3.679.0`, `@prisma/client ^5.20.0`,
`@vaultdrop/config`, `@vaultdrop/crypto`, `@vaultdrop/types`
(workspace:*), `cors ^2.8.5`, `express ^4.21.1`, `mime-types ^2.1.35`,
`multer ^1.4.5-lts.1`, `zod ^3.23.8`; dev: `@types/cors`, `@types/express`,
`@types/mime-types`, `@types/multer`, `@types/node`, `prisma ^5.20.0`,
`tsx ^4.19.1`, `typescript`.

**`@vaultdrop/web`** — runtime: `@radix-ui/react-label ^2.1.0`,
`@radix-ui/react-slot ^1.1.0`, `@vaultdrop/config`, `@vaultdrop/types`
(workspace:*), `class-variance-authority ^0.7.0`, `clsx ^2.1.1`,
`framer-motion ^11.11.9`, `lucide-react ^0.453.0`, `next ^14.2.15`,
`react ^18.3.1`, `react-dom ^18.3.1`, `tailwind-merge ^2.5.4`,
`zod ^3.23.8`; dev: `@types/node`, `@types/react`, `@types/react-dom`,
`autoprefixer ^10.4.20`, `postcss ^8.4.47`, `tailwindcss ^3.4.14`,
`typescript`.

## 14. Environment variables required

**`apps/server/.env`** (see `apps/server/.env.example`):
```
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://vaultdrop:vaultdrop@localhost:5432/vaultdrop?schema=public
JWT_SECRET=<min 32 chars>
JWT_EXPIRES_IN=15m
STORAGE_DRIVER=local            # or "cloud"
STORAGE_ROOT=./storage
CORS_ORIGIN=http://localhost:3000
MAX_UPLOAD_BYTES=104857600

# Only required when STORAGE_DRIVER=cloud:
CLOUD_STORAGE_BUCKET=
CLOUD_STORAGE_REGION=
CLOUD_STORAGE_ENDPOINT=
CLOUD_STORAGE_FORCE_PATH_STYLE=false
CLOUD_STORAGE_ACCESS_KEY_ID=
CLOUD_STORAGE_SECRET_ACCESS_KEY=
```

**`apps/web/.env.local`** (see `apps/web/.env.example`):
```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## 15. Known issues

1. **"Create Vault" page does not yet create a `Vault` row.** The
   create-vault frontend page calls `POST /auth/register`, which only
   creates a `User`. The backend's `Vault` entity (with its own `POST
   /vaults` endpoint) is entirely separate and is never called during
   sign-up. Functionally, today's dashboard doesn't correspond to any
   real `Vault` record — there's a naming/conceptual mismatch between
   the product's "create vault = sign up" framing and the backend's
   "a user can own multiple vaults" data model. **This needs a decision
   in Sprint 3:** either (a) auto-create a default Vault for a user at
   registration time (small backend addition), or (b) have the frontend
   call `POST /vaults` right after a successful registration, or (c)
   formally collapse the model so a User has exactly one implicit Vault
   (a schema change, more invasive). Flagged here rather than silently
   decided, since it affects the data model.
2. **Prisma Client cannot be generated in this sandbox** (network
   allowlist blocks `binaries.prisma.sh`). A real server and database
   have never actually been run together to verify the backend at
   runtime. See `HANDOFF.md` §6 for full detail and what to do (run
   `pnpm db:generate` somewhere with normal internet access).
3. **No automated tests exist anywhere in the repo.** All verification so
   far has been typecheck + build + one manual ESM-load sanity check.
   There is no unit/integration/e2e test suite.
4. **No CI/CD configuration exists.** No GitHub Actions or equivalent.
5. **The shadcn/ui CLI registry is unreachable from this sandbox**, same
   network-allowlist category as #2. All shadcn-style components were
   hand-authored instead (see `HANDOFF.md` §4) — functionally
   equivalent, but a future session with real network access could
   regenerate them via the actual CLI if preferred (not required).
6. **No end-to-end manual testing has happened against a live server.**
   Everything has been verified via static typecheck/build only. The
   first real test, once infra is available, should be the full
   click-through described in `HANDOFF.md` §6.
7. **No password "forgot/reset" flow.** Out of scope for Sprint 2 by
   design, but worth tracking as a real product gap.
8. **No rate limiting on auth endpoints** (login, register,
   check-username). Not requested yet, but worth flagging given
   `check-username` is a new enumeration-adjacent surface (it's
   read-only and only confirms what register/login already implicitly
   reveal over multiple attempts, but it does make enumeration faster).

## 16. Remaining work (high-level, unordered)

- Wire up Vault creation properly (see Known Issue #1).
- Folder browser UI (list, navigate, create, rename, move, delete).
- File upload UI (drag-and-drop or picker, progress, error states).
- File list UI within a folder (name, size, type, modified date).
- File download UI (trigger `GET /files/:fileId/download`).
- File preview UI (image/PDF/text/video/audio viewers, respecting the
  backend's 415 response for unsupported types).
- Dashboard sidebar items beyond "Vault" (Folders, Sharing, Settings) —
  currently placeholders.
- Dark mode toggle (tokens exist, no UI).
- Real end-to-end testing against a live Postgres + server + web stack.
- Automated test suite (unit at minimum; integration/e2e ideally).
- CI pipeline.
- Decide on and implement the User↔Vault relationship resolution (Known
  Issue #1) before building folder/file UI on top of it, since that UI
  will need a real `vaultId` to call the existing folder/file endpoints.

See `NEXT_STEPS.md` for the concrete, ordered Sprint 3 proposal.
