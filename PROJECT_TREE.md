# VaultDrop — PROJECT_TREE

Snapshot taken at the end of Sprint 2 (frontend authentication). Generated
from the actual filesystem (excludes `node_modules`, `dist`, `.next`,
`.turbo`, lockfile internals, `tsconfig.tsbuildinfo`).

```
vaultdrop/
├── .gitignore
├── package.json                     # root workspace scripts
├── pnpm-workspace.yaml               # workspaces: apps/*, packages/*
├── pnpm-lock.yaml
├── turbo.json                        # turbo pipeline: build, dev, typecheck, lint, clean
├── tsconfig.base.json                # shared strict TS compiler options (used by server + packages, NOT by web)
│
├── HANDOFF.md                        # ← start here in a new session
├── PROJECT_TREE.md                   # ← this file
├── CHANGELOG.md
├── PROJECT_STATE.md
├── NEXT_STEPS.md
├── NEW_CHAT_CONTINUATION_PROMPT.md    # copy-paste prompt for a brand-new Claude session
│
├── apps/
│   ├── web/                          # Next.js frontend — Sprint 2 (auth) COMPLETE
│   │   ├── package.json              # @vaultdrop/web
│   │   ├── tsconfig.json             # standalone (Next-specific), does NOT extend tsconfig.base.json
│   │   ├── next.config.mjs           # eslint.ignoreDuringBuilds = true (lint handled separately)
│   │   ├── next-env.d.ts             # committed so `tsc --noEmit` works without `next dev` first
│   │   ├── tailwind.config.ts        # shadcn-style CSS-variable theme, dark mode via .dark class
│   │   ├── postcss.config.mjs
│   │   ├── .env.example              # NEXT_PUBLIC_API_URL=http://localhost:4000
│   │   └── src/
│   │       ├── app/
│   │       │   ├── layout.tsx                      # root layout, mounts AppProviders, metadata
│   │       │   ├── globals.css                     # Tailwind directives + shadcn CSS variables (light + .dark)
│   │       │   ├── page.tsx                        # "/" Landing page
│   │       │   ├── auth/
│   │       │   │   ├── page.tsx                    # "/auth" Username entry
│   │       │   │   └── [username]/
│   │       │   │       ├── unlock/page.tsx         # "/auth/[username]/unlock" Password (existing user)
│   │       │   │       └── create/page.tsx         # "/auth/[username]/create" Create Vault (new user)
│   │       │   └── dashboard/
│   │       │       ├── layout.tsx                  # protected shell: auth guard + Sidebar + Topbar
│   │       │       └── page.tsx                    # empty/welcome main content, no upload UI
│   │       ├── components/
│   │       │   ├── ui/                             # hand-authored shadcn-style primitives
│   │       │   │   ├── button.tsx                  # variants: default/destructive/outline/secondary/ghost/link; sizes; asChild via Radix Slot
│   │       │   │   ├── input.tsx
│   │       │   │   ├── label.tsx                   # wraps @radix-ui/react-label
│   │       │   │   └── card.tsx                    # Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
│   │       │   ├── auth/
│   │       │   │   └── password-strength.tsx       # 4-bar strength meter, used on the create-vault page
│   │       │   ├── layout/
│   │       │   │   ├── sidebar.tsx                  # Vault (active) / Folders, Sharing, Settings (disabled, "Soon")
│   │       │   │   └── topbar.tsx                   # username + Logout button
│   │       │   └── providers/
│   │       │       ├── auth-provider.tsx            # AuthProvider + useAuth(): status/user/accessToken/login/register/logout
│   │       │       └── app-providers.tsx             # root wrapper, currently just AuthProvider
│   │       └── lib/
│   │           ├── api-client.ts                    # authApi.{checkUsername,register,login,logout,me}, ApiError
│   │           ├── validation.ts                     # usernameSchema, passwordSchema, getPasswordStrength()
│   │           └── utils.ts                          # cn() classname helper (clsx + tailwind-merge)
│   │
│   └── server/                       # Express backend — Sprint 1 COMPLETE, FROZEN except one additive endpoint
│       ├── package.json              # @vaultdrop/server
│       ├── tsconfig.json
│       ├── .env.example
│       └── src/
│           ├── index.ts              # entrypoint: load env, build app, listen, graceful shutdown
│           ├── app.ts                # createApp(prisma, env, storage) → Express app
│           ├── db/
│           │   └── prisma.ts         # PrismaClient singleton (dev-safe global cache)
│           ├── middleware/
│           │   ├── auth.ts           # createAuthMiddleware(env) → requireAuth
│           │   └── error-handler.ts  # central error → JSON response mapping
│           ├── routes/
│           │   ├── auth.routes.ts    # POST /register /login /logout, GET /me, GET /check-username (NEW in Sprint 2)
│           │   ├── auth.schemas.ts   # zod: usernameSchema, passwordSchema, registerSchema, loginSchema
│           │   ├── vault.routes.ts   # POST/GET / , GET/DELETE /:vaultId
│           │   ├── folder.routes.ts  # POST / , GET /contents , PATCH/DELETE /:folderId
│           │   └── file.routes.ts    # POST /upload , GET /:fileId(/download|/preview) , DELETE /:fileId
│           ├── services/
│           │   ├── auth.service.ts   # register, login, getCurrentUser, usernameExists (NEW in Sprint 2)
│           │   ├── vault.service.ts  # createVault, listVaults, getVault, getOwnedVaultOrThrow, deleteVault
│           │   ├── folder.service.ts # createFolder, getFolderContents, updateFolder, deleteFolder, getFolderOrThrow
│           │   └── file.service.ts   # uploadFile, getFileMetadata, getFileStream, deleteFile, getFileOrThrow
│           ├── storage/
│           │   ├── local-storage-adapter.ts   # LocalStorageAdapter implements StorageAdapter; buildVaultStorageKey()
│           │   ├── cloud-storage-adapter.ts   # CloudStorageAdapter implements StorageAdapter via AWS SDK v3 S3 client
│           │   └── storage-factory.ts         # createStorageAdapter(env) → Local | Cloud based on STORAGE_DRIVER
│           ├── types/
│           │   └── express.d.ts      # augments Express.Request with `user?: AccessTokenPayload`
│           └── utils/
│               ├── app-error.ts      # AppError + statusCode helpers
│               └── async-handler.ts  # asyncHandler() wraps async route handlers
│
├── packages/                          # ALL FROZEN since end of Sprint 1 — unchanged in Sprint 2
│   ├── types/                         # @vaultdrop/types
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts              # barrel
│   │       ├── entities.ts           # UserDTO, VaultDTO, FolderDTO, FileDTO, StorageProvider
│   │       ├── api.ts                # request/response contracts
│   │       ├── storage.ts            # StorageAdapter interface
│   │       └── auth.ts               # AccessTokenPayload
│   │
│   ├── crypto/                        # @vaultdrop/crypto
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── password.ts           # hashPassword, verifyPassword (Argon2id)
│   │       └── jwt.ts                # signAccessToken, verifyAccessToken, InvalidTokenError
│   │
│   ├── config/                        # @vaultdrop/config — imported (not modified) by apps/web in Sprint 2
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── server-env.ts         # loadServerEnv()
│   │       └── web-env.ts            # loadWebEnv() — now actually consumed, by apps/web/src/lib/api-client.ts
│   │
│   └── ui/                            # @vaultdrop/ui — built in Sprint 1, NOT used by apps/web (see HANDOFF.md §4)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── Button.tsx
│           ├── TextInput.tsx
│           └── Card.tsx
│
├── prisma/
│   └── schema.prisma                 # User, Vault, Folder, File models + StorageProvider enum (frozen)
│
├── docker/
│   └── docker-compose.yml            # local Postgres 16 for dev (user/pass/db = vaultdrop)
│
└── docs/                              # reserved — handoff docs currently live at repo root instead
```

## Build artifacts (not shown above, gitignored)

After `pnpm install` + `pnpm build`: `packages/*/dist`, `apps/server/dist`,
`apps/web/.next`. All were verified clean at the end of this sprint, then
removed before this snapshot was taken (this tree reflects source files
only).
