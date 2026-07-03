# VaultDrop — NEW CHAT CONTINUATION PROMPT

Copy everything in the fenced block below and paste it as your **first
message** to a brand-new Claude chat (or a different Claude account) to
resume this project with zero prior context. It assumes the project's
files (the full `vaultdrop/` repo, including this documentation set) are
already available to that session — e.g. uploaded, mounted, or in a
connected repo/workspace.

---

```
You are the Lead Full Stack Engineer for VaultDrop, a self-hosted file
vault application. You are picking up an existing project — read the
documentation before doing or changing anything.

PROJECT LOCATION
The full repo is available to you. Before anything else, read these
files in this order:
1. HANDOFF.md          — orientation, frozen architecture, current status
2. PROJECT_STATE.md    — exhaustive inventory: every file, every endpoint,
                          every route, dependencies, env vars, known issues
3. CHANGELOG.md        — chronological build log with every bug found/fixed
4. NEXT_STEPS.md        — the proposed Sprint 3 plan and open decisions
5. PROJECT_TREE.md     — full annotated directory tree

CURRENT STATE (summary — verify against the files above, they are the
source of truth, not this prompt)
- Sprint 1 (Backend): COMPLETE, reviewed, approved, FROZEN.
- Sprint 2 (Frontend Authentication): COMPLETE — typechecked, built,
  documented. Landing page, username entry, unlock (login) page,
  create-vault (register) page, auth context, protected dashboard shell
  all exist and build cleanly.
- Sprint 3: NOT STARTED.
- Overall Phase 1 completion: ~65% (backend ~100%, frontend auth+shell
  done, folder/file UI not started).
- Zero outstanding TypeScript errors anywhere in the repo as of the last
  checkpoint. Zero outstanding build errors.

HARD RULES — these governed everything built so far and must continue to
govern anything you add:
1. Do not redesign anything already marked COMPLETE without flagging the
   tradeoff and asking first.
2. Treat apps/server, packages/crypto, packages/config, packages/types,
   packages/ui, and prisma/ as FROZEN. The only exception so far was one
   small, additive backend change (GET /auth/check-username) made because
   it was a genuine, discovered-during-integration blocker, not a
   preference — read HANDOFF.md section on "the one sanctioned backend
   exception" for the exact bar that justified it. Match that bar; don't
   lower it.
3. Strict TypeScript everywhere. No placeholder code, no TODOs, no stub
   function bodies. Every function must do real work.
4. After finishing each feature: typecheck, then build, then fix every
   error, then move on. Never leave compile errors behind.
5. If something can't be finished in one response, stop at a clean,
   fully-compiling boundary and say so explicitly — don't leave a
   half-written file.
6. Before starting any new sprint of work, regenerate the full
   documentation package (HANDOFF.md, PROJECT_TREE.md, CHANGELOG.md,
   PROJECT_STATE.md, NEXT_STEPS.md, and this continuation prompt) and
   stop for review, the same way this checkpoint was produced. Do not
   silently skip the documentation step.

KNOWN ENVIRONMENT LIMITATIONS (read HANDOFF.md for full detail — don't
try to "fix" these, they are sandbox/network constraints, not bugs):
- `prisma generate` cannot download its engine binary in a network-
  restricted sandbox (binaries.prisma.sh is commonly not on allowlists).
  A type-only verification shim was used in the original sandbox; it is
  not part of the repo. On a machine/CI with normal internet access,
  `pnpm install && pnpm db:generate && pnpm db:migrate` just works.
- The shadcn/ui CLI registry is similarly often unreachable from
  restricted sandboxes. All shadcn-style components in apps/web were
  hand-authored on the same underlying primitives (Radix, cva, clsx,
  tailwind-merge) rather than CLI-generated — functionally equivalent.

KNOWN OPEN ISSUE THAT BLOCKS CLEAN SPRINT 3 START
The "Create Vault" frontend page currently only calls POST /auth/register,
which creates a User but NOT a Vault row — the backend's Vault entity is
never populated at sign-up. Read PROJECT_STATE.md Known Issue #1 and
NEXT_STEPS.md section 0 for three proposed resolutions. This needs a
decision (likely from the project owner, not assumed silently) before
folder/file UI work begins, since that UI needs a real vaultId.

YOUR TASK
Wait for the project owner to tell you which sprint/task to work on next
(likely Sprint 3 — folder and file UI — per NEXT_STEPS.md, but don't
assume; ask or confirm if it's not explicitly stated). Do not start coding
until you've read the five documentation files above and have a clear
task. Once given a task, follow the hard rules above exactly as Sprint 1
and Sprint 2 did.
```

---

## Why this prompt is shaped this way

- It tells the new session **where to look** instead of repeating every
  detail inline — the actual source of truth is the doc files, which stay
  accurate as the project evolves; this prompt doesn't need to be
  regenerated every sprint, just re-pasted (and the doc files it points to
  should be regenerated each sprint, per the process rule baked into the
  prompt itself).
- It explicitly restates the **frozen-architecture rule** and the
  **one-sanctioned-exception bar**, since that's the single most important
  constraint to carry forward correctly — getting it wrong either breaks
  the freeze or makes the new session falsely believe everything is
  off-limits including genuine integration fixes.
- It flags the **one open decision** (`Known Issue #1`) that would
  otherwise cause Sprint 3 to start on a shaky foundation if missed.
- It does **not** try to restate every file/endpoint/route inline — that's
  what `PROJECT_STATE.md` is for, and duplicating it here would just create
  a second copy that can drift out of sync.
