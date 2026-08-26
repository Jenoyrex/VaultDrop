# VaultDrop — CHANGELOG

Chronological build log across both sprints completed so far. Newest
entries at the top. This is a build log, not a semantic-versioned release
changelog — VaultDrop has not tagged a formal release yet.

> **Note:** earlier entries below reference `HANDOFF.md`, `PROJECT_STATE.md`,
> `PROJECT_TREE.md`, `NEXT_STEPS.md`, and `NEW_CHAT_CONTINUATION_PROMPT.md` —
> internal sprint-handoff working documents used during development. They
> have since been removed as part of preparing this repository for public
> release; this changelog is kept as the durable historical record in their
> place.

---

## Sprint 2 — Frontend Authentication (COMPLETE, documentation checkpoint closed)

### Scope guardrails honored
- Worked only inside `apps/web`, with one sanctioned, additive exception in
  `apps/server` (see below) required to make the spec's username-routing
  step possible at all.
- Did not touch `packages/crypto`, `packages/config`, `packages/types`,
  `packages/ui`, or `prisma`.
- Did not build file upload, folders, settings, sharing, or admin —
  explicitly out of scope per Sprint 2 instructions.

### Modified — `apps/server` (one additive exception to the freeze)
- `apps/server/src/services/auth.service.ts` — added
  `usernameExists(username): Promise<boolean>`. No existing method
  changed.
- `apps/server/src/routes/auth.routes.ts` — added
  `GET /auth/check-username?username=<username>` → `{ exists: boolean }`,
  public, validated with a new inline zod schema
  (`usernameQuerySchema`). No existing route changed.
- **Why:** `POST /auth/login` deliberately returns the same generic 401
  for "wrong password" and "no such user" (anti-enumeration by design),
  so there was no existing, safe way to implement the required
  username → unlock-or-create routing step. Probing via
  `POST /auth/register` would have created throwaway accounts just to
  test existence. A dedicated read-only lookup was the only sound option.
- **Verification after the change:** `pnpm --filter @vaultdrop/server
  typecheck` and `build` re-run, both clean.

### Added — `apps/web` (new app; did not exist before this sprint)

**Monorepo wiring (8 files)**
- `apps/web/package.json` — `@vaultdrop/web`.
- `apps/web/tsconfig.json` — standalone, Next-specific config.
- `apps/web/next.config.mjs`
- `apps/web/tailwind.config.ts`
- `apps/web/postcss.config.mjs`
- `apps/web/next-env.d.ts`
- `apps/web/.env.example`
- `apps/web/src/app/globals.css`

**Pages — App Router (6 files, 6 routes)**
- `apps/web/src/app/layout.tsx` — root layout, mounts `AppProviders`.
- `apps/web/src/app/page.tsx` — `/` Landing page.
- `apps/web/src/app/auth/page.tsx` — `/auth` Username entry.
- `apps/web/src/app/auth/[username]/unlock/page.tsx` —
  `/auth/[username]/unlock` Password (existing user).
- `apps/web/src/app/auth/[username]/create/page.tsx` —
  `/auth/[username]/create` Create Vault (new user).
- `apps/web/src/app/dashboard/layout.tsx` — protected shell (auth guard +
  Sidebar + Topbar).
- `apps/web/src/app/dashboard/page.tsx` — empty/welcome main content.

**Components (9 files)**
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/input.tsx`
- `apps/web/src/components/ui/label.tsx`
- `apps/web/src/components/ui/card.tsx`
- `apps/web/src/components/auth/password-strength.tsx`
- `apps/web/src/components/layout/sidebar.tsx`
- `apps/web/src/components/layout/topbar.tsx`
- `apps/web/src/components/providers/auth-provider.tsx`
- `apps/web/src/components/providers/app-providers.tsx`

**Lib (3 files)**
- `apps/web/src/lib/api-client.ts`
- `apps/web/src/lib/validation.ts`
- `apps/web/src/lib/utils.ts`

**Total new files this sprint: 28** (2 backend files modified in place,
not counted as "new").

### Bug found and fixed during this sprint's build pass
- **Symptom:** `next build` failed prerendering `/` with `Error: Slot
  failed to slot onto its children. Expected a single React element child
  or 'Slottable'.`
- **Root cause:** `Button`'s `asChild` mode renders via Radix `Slot`,
  which requires exactly one React element child. The component was
  unconditionally rendering `{isLoading && <Loader2 .../>}` followed by
  `{children}` — when `asChild` is true and `isLoading` is false, `Slot`
  still receives two child nodes (`false` and the actual child), which
  Radix rejects.
- **Fix:** Split `Button`'s render path — the `asChild` branch renders
  `<Slot>{children}</Slot>` with nothing else injected; the
  loading-spinner injection only happens in the plain-`<button>` branch.
  File: `apps/web/src/components/ui/button.tsx`.
- **Verification:** `pnpm --filter @vaultdrop/web build` re-run after the
  fix — all 6 routes compiled successfully.

### Verification performed
```
pnpm --filter @vaultdrop/server typecheck   # clean
pnpm --filter @vaultdrop/server build       # clean
pnpm --filter @vaultdrop/web typecheck      # clean
pnpm --filter @vaultdrop/web build          # FAILED once (Slot bug above), clean after the fix
```

### Documentation checkpoint (this entry)
- Regenerated `HANDOFF.md`, `PROJECT_TREE.md`, `CHANGELOG.md` (this file),
  `PROJECT_STATE.md`, `NEXT_STEPS.md`.
- Added `NEW_CHAT_CONTINUATION_PROMPT.md` — a self-contained prompt for
  starting a brand-new Claude session on this project.
- No source code was touched in this checkpoint — documentation only, as
  instructed.

---

## Sprint 1 — Backend (COMPLETE, reviewed and approved, now FROZEN)

### Added — Monorepo scaffold (7 files)
- `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`,
  `.gitignore`, `prisma/schema.prisma`, `docker/docker-compose.yml`.

### Added — `packages/types` (6 files)
- `package.json`, `tsconfig.json`, `src/index.ts`, `src/entities.ts`,
  `src/api.ts`, `src/storage.ts`, `src/auth.ts` (7, corrected count).
- `entities.ts`: `UserDTO`, `VaultDTO`, `FolderDTO`, `FileDTO`,
  `StorageProvider` ("LOCAL" | "CLOUD").
- `api.ts`: request/response contracts (`RegisterRequest`,
  `LoginRequest`, `AuthResponse`, `CreateVaultRequest`,
  `CreateFolderRequest`, `UpdateFolderRequest`,
  `FileUploadMetadataResponse`, `FolderContentsResponse`,
  `ApiErrorBody`, `ApiResult<T>`).
- `storage.ts`: the `StorageAdapter` interface (`put`, `get`, `getStream`,
  `delete`, `exists`) plus `StoragePutInput` / `StorageObjectMeta`.
- `auth.ts`: `AccessTokenPayload` (`sub`, `username`, `iat?`, `exp?`).
- Required adding `@types/node` as a dev dependency (initial build failed
  with `Cannot find name 'Buffer'` / `Cannot find namespace 'NodeJS'`).

### Added — `packages/config` (5 files)
- `package.json`, `tsconfig.json`, `src/index.ts`, `src/server-env.ts`,
  `src/web-env.ts`.
- `server-env.ts`: `loadServerEnv()` — zod schema validating `NODE_ENV`,
  `PORT`, `DATABASE_URL`, `JWT_SECRET` (min 32 chars), `JWT_EXPIRES_IN`,
  `STORAGE_DRIVER` (`local`|`cloud`), `STORAGE_ROOT`, `CORS_ORIGIN`,
  `MAX_UPLOAD_BYTES`.
- `web-env.ts`: `loadWebEnv()` — zod schema for `NEXT_PUBLIC_API_URL`.
- Same `@types/node` fix as above was needed here too.

### Added — `packages/crypto` (5 files)
- `package.json`, `tsconfig.json`, `src/index.ts`, `src/password.ts`,
  `src/jwt.ts`.
- `password.ts`: `hashPassword` / `verifyPassword` using `argon2`
  (argon2id, memoryCost 19456, timeCost 2, parallelism 1).
- `jwt.ts`: `signAccessToken` / `verifyAccessToken` / `InvalidTokenError`
  using `jsonwebtoken`.
- **Bug fixed during build:** `argon2.Options & { type: argon2.argon2id }`
  failed to typecheck because the installed `argon2` package types
  `type` as the numeric literal union `0 | 1 | 2`, not a named
  `argon2id` type alias. Simplified to `argon2.Options` with
  `type: argon2.argon2id` (the runtime constant).

### Added — `packages/ui` (5 files)
- `package.json`, `tsconfig.json`, `src/index.ts`, `src/Button.tsx`,
  `src/TextInput.tsx`, `src/Card.tsx` (6, corrected count).
- Minimal shared component set, inline-styled (no CSS framework
  dependency). **Note (confirmed in Sprint 2):** `apps/web` does not use
  this package — it built its own Tailwind/shadcn-based primitives
  instead (see `HANDOFF.md`). This package remains valid, frozen, and
  simply unused by the web app today.

### Added — `prisma/schema.prisma` (already counted above)
- `User`, `Vault`, `Folder`, `File` models + `StorageProvider` enum, full
  relations and cascade rules — see `PROJECT_STATE.md` for the complete
  field-by-field summary.

### Added — `apps/server` (20 files)
- `package.json`, `tsconfig.json`, `.env.example`,
  `src/index.ts`, `src/app.ts`,
  `src/db/prisma.ts`,
  `src/middleware/auth.ts`, `src/middleware/error-handler.ts`,
  `src/routes/auth.routes.ts`, `src/routes/auth.schemas.ts`,
  `src/routes/vault.routes.ts`, `src/routes/folder.routes.ts`,
  `src/routes/file.routes.ts`,
  `src/services/auth.service.ts`, `src/services/vault.service.ts`,
  `src/services/folder.service.ts`, `src/services/file.service.ts`,
  `src/storage/local-storage-adapter.ts`,
  `src/storage/cloud-storage-adapter.ts`, `src/storage/storage-factory.ts`,
  `src/types/express.d.ts`,
  `src/utils/app-error.ts`, `src/utils/async-handler.ts`
  (23 files, corrected count).
- Full feature summary: see `PROJECT_STATE.md` → Backend Architecture
  Summary and Backend Endpoints sections.
- **Bugs fixed during build:** a copy-paste `import { z } from "express"`
  typo in `vault.routes.ts` (should be `"zod"`); an unsafe
  `string | Uint8Array` → `Uint8Array` cast in
  `cloud-storage-adapter.ts`'s stream-to-buffer loop (replaced with an
  explicit `Buffer.isBuffer`/`typeof === "string"`/fallback branch); an
  implicit-`any` callback parameter in `folder.service.ts`'s
  `getFolderContents` (fixed by importing and annotating with
  `File as PrismaFile`).

### Environment limitation hit and resolved (Sprint 1, still true today)
- `pnpm prisma generate` failed in this sandbox with `403 Forbidden`
  fetching from `https://binaries.prisma.sh/...` — that domain isn't on
  the sandbox's network allowlist. Worked around **for verification
  purposes only** by hand-writing a type-shim into the unbuilt
  `@prisma/client` package's `.prisma/client/{index,default}.d.ts` inside
  `node_modules`, shaped exactly like what Prisma would generate. Not
  part of the repo, not committed, replaced automatically the moment
  `prisma generate` runs with real network access.

### Verification performed
- `pnpm --filter @vaultdrop/types build` — clean.
- `pnpm --filter @vaultdrop/config build` — clean.
- `pnpm --filter @vaultdrop/crypto build` — clean.
- `pnpm --filter @vaultdrop/ui build` — clean.
- `pnpm --filter @vaultdrop/server typecheck` — clean.
- `pnpm --filter @vaultdrop/server build` — clean.
- Compiled server's `dist/app.js` loaded via
  `node --input-type=module -e "import { createApp } from './dist/app.js'"`
  and confirmed `createApp` is a function.
