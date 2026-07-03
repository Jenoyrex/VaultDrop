# VaultDrop — HANDOFF

> Read this file first. It is written so a brand-new Claude session, with no
> memory of prior conversations, can resume work safely without breaking
> anything that already works.

## 0. Headline metrics (documentation checkpoint, end of Sprint 2)

| Metric | Value |
|---|---|
| Documented version label | `v0.2.0` (package.json files still literally read `0.1.0` — no version bump was requested or made) |
| Sprint 1 (Backend) | ✅ COMPLETE — reviewed, approved, **FROZEN** |
| Sprint 2 (Frontend Authentication) | ✅ COMPLETE — typechecked, built, documented |
| Sprint 3 | ⏸ NOT STARTED — waiting for explicit go-ahead |
| Overall Phase 1 completion | **~65%** (full breakdown in `PROJECT_STATE.md` §2) |
| Backend typecheck | ✅ clean |
| Backend build | ✅ clean |
| Frontend typecheck | ✅ clean |
| Frontend build | ✅ clean (one bug found and fixed mid-sprint — see `CHANGELOG.md`) |
| Known issues open | 8 (see `PROJECT_STATE.md` §15) — none blocking, one (#1, the Vault-creation gap) should be resolved before Sprint 3 UI work begins |

For a brand-new chat with zero context, the fastest path to full context
is: this file, then `PROJECT_STATE.md`, then `NEXT_STEPS.md`. Or, even
faster: paste `NEW_CHAT_CONTINUATION_PROMPT.md` directly as your first
message to a new Claude session — it's a self-contained summary built for
exactly that purpose.

## 1. What VaultDrop is

VaultDrop is a self-hosted file vault application. Users register with a
username/password, create one or more "vaults," organize files into nested
folders inside a vault, and upload/download/preview files. Storage is
pluggable (local disk today, cloud/S3-compatible interface already defined).

## 2. What phase/sprint we are in

- **Sprint 1 (backend, Phase 1 API surface): COMPLETE. Reviewed and
  approved. The backend architecture is FROZEN.**
- **Sprint 2 (frontend authentication): COMPLETE.** Built, typechecked, and
  production-built with zero errors. **Stopped here intentionally — do not
  start Sprint 3 without explicit instruction to proceed.**

### Standing rule carried forward from Sprint 1 → Sprint 2 → onward

> Do not modify backend code (`apps/server`, `packages/crypto`,
> `packages/config`, `packages/types`, `packages/ui`, `prisma`) unless
> fixing a bug discovered during frontend integration. One such fix was
> made in Sprint 2 — see §3 below — and it is the *only* backend change
> since the freeze. If you are continuing this project, keep that bar high:
> a genuinely missing capability discovered while wiring up the frontend
> qualifies; a preference for a different shape, a "nicer" endpoint, or a
> refactor does not.

## 3. The one sanctioned backend exception (read this before touching `apps/server`)

Sprint 2's spec requires: enter a username → if it belongs to an existing
vault, show the unlock/password screen; if not, show the create-vault
screen. The pre-existing `POST /auth/login` deliberately returns the same
generic 401 for both "wrong password" and "no such user" (anti-enumeration
by design), so there was no safe way to implement the required
username-routing step with the API as it stood — and probing via
`POST /auth/register` would have actually created throwaway accounts just
to test existence, which is destructive and wrong.

**What was added (and nothing else):**
- `AuthService.usernameExists(username): Promise<boolean>` in
  `apps/server/src/services/auth.service.ts`.
- `GET /auth/check-username?username=<username>` → `{ exists: boolean }`
  in `apps/server/src/routes/auth.routes.ts`, public (no auth required,
  same as register/login), validated with a small inline zod schema.

No existing route, service method, or type was changed. `pnpm --filter
@vaultdrop/server typecheck` and `build` were re-run after this change and
are still clean. This is documented exhaustively so a future session
doesn't mistake it for scope creep or try to "fix" it — it's intentional
and necessary.

## 4. Frozen architecture

```
vaultdrop/
  apps/
    web/        ← Next.js frontend — Sprint 2 (auth) COMPLETE, file/folder UI NOT built yet
    server/     ← Express backend — COMPLETE for Phase 1, FROZEN (see §3 for the one exception)
  packages/
    crypto/     ← Argon2 password hashing + JWT sign/verify (COMPLETE, FROZEN)
    ui/         ← Shared React components: Button, TextInput, Card (COMPLETE, FROZEN, NOT used by apps/web)
    types/      ← Shared TS types/DTOs + StorageAdapter interface (COMPLETE, FROZEN)
    config/     ← Zod-validated env loaders for server & web (COMPLETE, FROZEN)
  prisma/
    schema.prisma   ← User, Vault, Folder, File models (COMPLETE, FROZEN)
  docker/
    docker-compose.yml  ← local Postgres for dev (COMPLETE)
  docs/             ← reserved; handoff docs currently live at repo root
  package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json
```

- **Package manager:** pnpm workspaces. **Build orchestration:** Turborepo.
- **`apps/web` is its own design system.** It does NOT use
  `packages/ui` (which is plain-inline-styled and was built before the
  Sprint 2 spec called for TailwindCSS + ShadCN UI). Instead, `apps/web`
  has its own hand-authored shadcn-style primitives under
  `apps/web/src/components/ui/` (Button, Input, Label, Card family) built
  directly on Radix primitives + `class-variance-authority` + `clsx` +
  `tailwind-merge` — the same building blocks the real shadcn/ui CLI
  generates, just hand-written because the shadcn registry domain isn't
  reachable from this sandbox's network allowlist. **Do not try to run
  `npx shadcn add ...`** in this sandbox; it will fail for the same
  network-allowlist reason described for Prisma in §6. Either hand-write
  new primitives following the existing ones as a template, or run the
  CLI yourself somewhere with normal internet access and drop the files in.
- **`apps/web` ↔ `apps/server` independence:** the web app shares code only
  through `packages/types` and `packages/config` (both imported, neither
  modified). It talks to the backend exclusively over HTTP via
  `apps/web/src/lib/api-client.ts`. It does not import anything from
  `apps/server`.
- **Auth on the frontend:** `apps/web/src/components/providers/auth-provider.tsx`
  — a React Context (`AuthProvider` + `useAuth()`) that is the single
  source of truth for session state app-wide. Session shape:
  `{ status: "loading" | "authenticated" | "unauthenticated", user,
  accessToken, login, register, logout }`. Persisted to
  `window.localStorage` under the key `vaultdrop.session` as
  `{ user, accessToken }`. On mount, the provider re-validates the stored
  token against `GET /auth/me` rather than trusting the cache blindly
  (handles expired tokens / rotated secrets / deleted users). **Use
  `useAuth()` for any future auth-aware UI — don't create a second auth
  source of truth.**
- **Protected routes:** `apps/web/src/app/dashboard/layout.tsx` is a client
  component that reads `status` from `useAuth()` and redirects to `/auth`
  if `status === "unauthenticated"`, showing a spinner while `"loading"`.
  This is the pattern for any future protected route — wrap it in (or
  nest it under) a layout that does this same check. There is currently
  no middleware-based (edge/cookie) route protection, because the session
  token lives in `localStorage`, not a cookie, so Next middleware can't see
  it; protection is client-side only for now.

## 5. Sprint 2 deliverables in detail

### Pages (Next.js App Router, all under `apps/web/src/app/`)

| Route | File | Purpose |
|---|---|---|
| `/` | `page.tsx` | Landing page: logo, tagline "Your Files. Your Password. Your Vault.", Get Started → `/auth`, Learn More → scrolls to an in-page feature section (`#learn-more`). |
| `/auth` | `auth/page.tsx` | Username entry. Validates format client-side, then calls `GET /auth/check-username`, then routes to `/auth/[username]/unlock` (exists) or `/auth/[username]/create` (doesn't). |
| `/auth/[username]/unlock` | `auth/[username]/unlock/page.tsx` | Password entry for an existing username. Calls `useAuth().login`. On success → `/dashboard`. |
| `/auth/[username]/create` | `auth/[username]/create/page.tsx` | Password + confirm-password for a new username, with a live strength meter. Calls `useAuth().register`. On success → `/dashboard`. |
| `/dashboard` | `dashboard/layout.tsx` + `dashboard/page.tsx` | Protected shell: sidebar (Vault active; Folders/Sharing/Settings shown but disabled with a "Soon" badge — **do not wire these up yet, that's later sprints**) + top bar (username + Logout) + an empty/welcome main area. **No upload UI, no folder UI — that's explicitly out of scope for Sprint 2.** |

### Supporting code

- `lib/api-client.ts` — typed `fetch` wrapper (`authApi.checkUsername`,
  `.register`, `.login`, `.logout`, `.me`), throws `ApiError` (status +
  code + message) on non-2xx responses, reads the base URL from
  `@vaultdrop/config`'s `loadWebEnv` (env var `NEXT_PUBLIC_API_URL`,
  default `http://localhost:4000`).
- `lib/validation.ts` — client-side mirrors of the server's username/
  password zod rules (kept as a deliberate duplicate, not a shared
  package, since `apps/web` can't import server-internal modules) plus
  `getPasswordStrength()` used by the strength meter.
- `lib/utils.ts` — the standard shadcn `cn()` classname helper
  (`clsx` + `tailwind-merge`).
- `components/ui/{button,input,label,card}.tsx` — hand-authored
  shadcn-style primitives (see §4 note above on why hand-authored).
- `components/auth/password-strength.tsx` — the strength meter (4 bars +
  label), used only on the create-vault page.
- `components/layout/{sidebar,topbar}.tsx` — dashboard shell pieces.
- `components/providers/{auth-provider,app-providers}.tsx` — session
  context + the root provider wrapper mounted in `app/layout.tsx`.

### Styling / tooling
- TailwindCSS with a shadcn-style CSS-variable theme (`app/globals.css`,
  `tailwind.config.ts`) — light theme tokens fully defined, a `.dark`
  class with dark tokens is included but **no theme toggle UI exists
  yet** (deliberately out of scope; the tokens are there for whoever
  builds that later).
- Framer Motion for entrance/scroll-triggered animation on the landing
  page and subtle fade/slide on the auth cards and dashboard empty state.
- Lucide React for all icons (`ShieldCheck`, `Lock`, `KeyRound`,
  `FolderLock`, `ArrowRight`, `ArrowLeft`, `Loader2`, `LogOut`, `User`,
  `Vault`, `FolderClosed`, `Settings`, `Users`).

## 6. Known environment limitations (carried over, still true)

- **Prisma engine download still blocked in this sandbox** (network
  allowlist doesn't include `binaries.prisma.sh`). Unchanged from Sprint
  1 — see `CHANGELOG.md`'s Sprint 1 entry for the full explanation of the
  verification-only type-shim that was used and why it's safe to ignore.
  Nothing about Sprint 2 touches this; it remains true that a real
  database/Prisma client requires running `pnpm db:generate` /
  `pnpm db:migrate` somewhere with normal internet access.
- **shadcn/ui CLI registry is also unreachable from this sandbox**, for the
  same kind of reason (network allowlist). Sprint 2 worked around this by
  hand-writing the primitives shadcn would have generated, using the exact
  same underlying packages (`@radix-ui/react-*`,
  `class-variance-authority`, `clsx`, `tailwind-merge`) so the output is
  structurally identical to what the CLI produces. No functionality was
  skipped because of this — only the generation *method* differs.
- **No live backend was running during Sprint 2 verification.** The
  `/auth` flow, login, register, and dashboard guard were verified by
  typecheck + production build only (Next.js successfully statically
  generates `/`, `/auth`, `/dashboard` and renders `/auth/[username]/...`
  as dynamic routes — see the build output transcript in `CHANGELOG.md`).
  **End-to-end testing against a real running server has not happened
  yet.** First real test should be: start Postgres
  (`docker compose -f docker/docker-compose.yml up -d`), run
  `pnpm db:generate && pnpm db:migrate`, start the server
  (`pnpm --filter @vaultdrop/server dev`), start the web app
  (`pnpm --filter @vaultdrop/web dev`), and walk through: visit `/`,
  click Get Started, enter a brand-new username, confirm it routes to the
  create-vault screen, set a password, confirm it lands on `/dashboard`,
  refresh the page (session should persist via `GET /auth/me`), log out,
  re-enter the same username, confirm it now routes to the unlock screen.

## 7. Verification performed this sprint

```
pnpm --filter @vaultdrop/server typecheck   # clean (re-verified after the check-username addition)
pnpm --filter @vaultdrop/server build       # clean
pnpm --filter @vaultdrop/web typecheck      # clean
pnpm --filter @vaultdrop/web build          # clean — see CHANGELOG.md for the full route-size table
```

One real bug was caught and fixed during this sprint's build pass: the
shared `Button` component's `asChild` mode (Radix `Slot`) was rendering a
conditional loading-icon node alongside `children`, which violates `Slot`'s
"exactly one element child" requirement and broke static prerendering of
the landing page. Fixed by only injecting the loading icon in the
plain-`<button>` branch, never in the `asChild`/`Slot` branch. Full detail
in `CHANGELOG.md`.

## 8. Where to resume

Read `NEXT_STEPS.md` for the Sprint 3 candidate plan (folders + file
upload/download/preview UI) — but **do not start it without explicit
go-ahead**, per this sprint's instructions. Read `PROJECT_STATE.md` for an
exhaustive file-by-file inventory of the entire repo as it stands today.
Read `PROJECT_TREE.md` for the current directory tree. Read
`CHANGELOG.md` for the full chronological build log across both sprints.
