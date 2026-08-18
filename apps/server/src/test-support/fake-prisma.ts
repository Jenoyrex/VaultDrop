import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

/**
 * Builds a real `Prisma.PrismaClientKnownRequestError` with code `P2002`
 * (unique constraint violation) — the same error shape/instance type the
 * real client throws when a `create`/`update` collides with a unique
 * index. Used to simulate the TOCTOU race where two concurrent requests
 * both pass a `findFirst` duplicate-name pre-check before either commits.
 */
function makeUniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields",
    { code: "P2002", clientVersion: "test" }
  );
}

/**
 * A minimal in-memory stand-in for `PrismaClient`, covering only the
 * subset of calls the file/folder routes actually make (vault ownership
 * lookup, duplicate-name checks, create/update/delete/list). Used so
 * route integration tests don't require a live Postgres instance. Not a
 * general Prisma mock — extend the covered surface only if a test
 * genuinely needs a call this doesn't yet support.
 */

export interface FakeVaultRow {
  id: string;
  ownerId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  encryptionVersion: number | null;
  kekSalt: string | null;
  kekIterations: number | null;
  kekHash: string | null;
  wrappedDekCiphertext: string | null;
  wrappedDekIv: string | null;
  recoveryWrappedDekCiphertext: string | null;
  recoveryWrappedDekIv: string | null;
}

/** Only `id`/`ownerId`/`name` are required to seed a vault in a test —
 * every other column defaults the same way a fresh, unencrypted, legacy
 * vault row would (nulls, "now" timestamps), so existing callers that
 * only care about ownership checks don't need to change. */
export type SeedVaultRow = Pick<FakeVaultRow, "id" | "ownerId" | "name"> &
  Partial<Omit<FakeVaultRow, "id" | "ownerId" | "name">>;

export interface FakeFileRow {
  id: string;
  name: string | null;
  mimeType: string;
  sizeBytes: number;
  vaultId: string;
  folderId: string | null;
  storageProvider: "LOCAL" | "CLOUD";
  storageKey: string;
  createdAt: Date;
  updatedAt: Date;
  encrypted: boolean;
  wrappedKeyCiphertext: string | null;
  wrappedKeyIv: string | null;
  encryptedName: string | null;
  nameIv: string | null;
}

export interface FakeUserRow {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

type CreateUserData = Omit<FakeUserRow, "id" | "createdAt" | "updatedAt">;

/** Mirrors the real `VaultService.createVault` call: `ownerId`/`name` are
 * always given, every other column (encryption envelope fields) is only
 * spread in conditionally for an encrypted vault, so all of them must stay
 * optional here rather than following the plain `Omit<...>` pattern used
 * for file/folder, which always provides every non-id/timestamp field. */
type CreateVaultData = Pick<FakeVaultRow, "ownerId" | "name"> &
  Partial<Omit<FakeVaultRow, "id" | "ownerId" | "name" | "createdAt" | "updatedAt">>;

export interface FakeFolderRow {
  id: string;
  name: string | null;
  vaultId: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  encrypted: boolean;
  encryptedName: string | null;
  nameIv: string | null;
}

type CreateFileData = Omit<FakeFileRow, "id" | "createdAt" | "updatedAt">;
type CreateFolderData = Omit<FakeFolderRow, "id" | "createdAt" | "updatedAt">;

interface FindFirstWhere {
  vaultId: string;
  folderId?: string | null;
  parentId?: string | null;
  name: string | null;
  NOT?: { id: string };
}

interface FindManyWhere {
  vaultId: string;
  folderId?: string | null;
  parentId?: string | null;
}

export function createFakePrisma(
  seedVaults: SeedVaultRow[] = [],
  seedUsers: FakeUserRow[] = []
): {
  prisma: PrismaClient;
  vaults: FakeVaultRow[];
  files: FakeFileRow[];
  folders: FakeFolderRow[];
  users: FakeUserRow[];
  /**
   * Test-only hook: makes `vault.update` throw for the given vault id on
   * its next call (and every call after, until cleared with `null`) —
   * used to simulate a mid-transaction DB failure and assert that
   * `$transaction`'s rollback genuinely undoes everything applied so far
   * in that transaction, not just the operation that failed.
   */
  forceVaultUpdateFailureFor: (vaultId: string | null) => void;
  /**
   * Test-only hook: makes the next `file.create` / `file.update` /
   * `folder.create` / `folder.update` call throw a real
   * `Prisma.PrismaClientKnownRequestError` (code `P2002`), then resets
   * itself — one call, one simulated race. Used to exercise the P2002
   * safety net *without* going through (and being caught by) the
   * `findFirst` pre-check, i.e. the genuine TOCTOU race path rather than
   * the ordinary friendly-conflict path.
   */
  forceNextUniqueViolation: (
    target: "file.create" | "file.update" | "folder.create" | "folder.update"
  ) => void;
} {
  let forcedVaultUpdateFailureId: string | null = null;
  const forcedUniqueViolations = {
    "file.create": false,
    "file.update": false,
    "folder.create": false,
    "folder.update": false
  };
  const now = new Date();
  const vaults: FakeVaultRow[] = seedVaults.map((seed) => ({
    createdAt: now,
    updatedAt: now,
    encryptionVersion: null,
    kekSalt: null,
    kekIterations: null,
    kekHash: null,
    wrappedDekCiphertext: null,
    wrappedDekIv: null,
    recoveryWrappedDekCiphertext: null,
    recoveryWrappedDekIv: null,
    ...seed
  }));
  const files: FakeFileRow[] = [];
  const folders: FakeFolderRow[] = [];
  const users: FakeUserRow[] = [...seedUsers];

  const fake = {
    user: {
      async findUnique({ where }: { where: { id?: string; username?: string } }) {
        if (where.id !== undefined) {
          return users.find((user) => user.id === where.id) ?? null;
        }
        if (where.username !== undefined) {
          return users.find((user) => user.username === where.username) ?? null;
        }
        return null;
      },
      async create({ data }: { data: CreateUserData }) {
        const nowCreated = new Date();
        const row: FakeUserRow = {
          id: randomUUID(),
          createdAt: nowCreated,
          updatedAt: nowCreated,
          ...data
        };
        users.push(row);
        return row;
      },
      async update({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<Omit<FakeUserRow, "id">>;
      }) {
        const row = users.find((user) => user.id === where.id);
        if (!row) {
          throw new Error(`fake-prisma: user ${where.id} not found`);
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }
    },
    vault: {
      async findUnique({ where }: { where: { id: string } }) {
        return vaults.find((vault) => vault.id === where.id) ?? null;
      },
      // Only the shape `AuthService.changePassword` actually calls:
      // "every vault owned by this user that currently has an encryption
      // envelope", selecting just `id`. Extend if a future caller needs
      // a different filter/select shape.
      async findMany({
        where
      }: {
        where: { ownerId: string; wrappedDekCiphertext: { not: null } };
        select?: { id: true };
      }) {
        return vaults
          .filter(
            (vault) =>
              vault.ownerId === where.ownerId && vault.wrappedDekCiphertext !== null
          )
          .map((vault) => ({ id: vault.id }));
      },
      async create({ data }: { data: CreateVaultData }) {
        const nowCreated = new Date();
        const row: FakeVaultRow = {
          id: randomUUID(),
          createdAt: nowCreated,
          updatedAt: nowCreated,
          encryptionVersion: null,
          kekSalt: null,
          kekIterations: null,
          kekHash: null,
          wrappedDekCiphertext: null,
          wrappedDekIv: null,
          recoveryWrappedDekCiphertext: null,
          recoveryWrappedDekIv: null,
          ...data
        };
        vaults.push(row);
        return row;
      },
      async update({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<Omit<FakeVaultRow, "id" | "ownerId">>;
      }) {
        if (where.id === forcedVaultUpdateFailureId) {
          throw new Error(`fake-prisma: simulated update failure for vault ${where.id}`);
        }
        const row = vaults.find((vault) => vault.id === where.id);
        if (!row) {
          throw new Error(`fake-prisma: vault ${where.id} not found`);
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }
    },
    file: {
      async findFirst({ where }: { where: FindFirstWhere }) {
        return (
          files.find(
            (file) =>
              file.vaultId === where.vaultId &&
              file.folderId === (where.folderId ?? null) &&
              file.name === where.name &&
              (!where.NOT || file.id !== where.NOT.id)
          ) ?? null
        );
      },
      async findUnique({ where }: { where: { id: string } }) {
        return files.find((file) => file.id === where.id) ?? null;
      },
      async findMany({ where }: { where: FindManyWhere }) {
        return files.filter((file) => {
          if (file.vaultId !== where.vaultId) return false;
          if ("folderId" in where && file.folderId !== where.folderId) return false;
          return true;
        });
      },
      async create({ data }: { data: CreateFileData }) {
        if (forcedUniqueViolations["file.create"]) {
          forcedUniqueViolations["file.create"] = false;
          throw makeUniqueConstraintError();
        }
        const now = new Date();
        const row: FakeFileRow = {
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          ...data
        };
        files.push(row);
        return row;
      },
      async update({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<CreateFileData>;
      }) {
        if (forcedUniqueViolations["file.update"]) {
          forcedUniqueViolations["file.update"] = false;
          throw makeUniqueConstraintError();
        }
        const row = files.find((file) => file.id === where.id);
        if (!row) {
          throw new Error(`fake-prisma: file ${where.id} not found`);
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      async delete({ where }: { where: { id: string } }) {
        const index = files.findIndex((file) => file.id === where.id);
        if (index === -1) {
          throw new Error(`fake-prisma: file ${where.id} not found`);
        }
        const [row] = files.splice(index, 1);
        return row;
      }
    },
    folder: {
      async findUnique({ where }: { where: { id: string } }) {
        return folders.find((folder) => folder.id === where.id) ?? null;
      },
      async findFirst({ where }: { where: FindFirstWhere }) {
        return (
          folders.find(
            (folder) =>
              folder.vaultId === where.vaultId &&
              folder.parentId === (where.parentId ?? null) &&
              folder.name === where.name &&
              (!where.NOT || folder.id !== where.NOT.id)
          ) ?? null
        );
      },
      async findMany({ where }: { where: FindManyWhere }) {
        return folders.filter((folder) => {
          if (folder.vaultId !== where.vaultId) return false;
          if ("parentId" in where && folder.parentId !== where.parentId) return false;
          return true;
        });
      },
      async create({ data }: { data: CreateFolderData }) {
        if (forcedUniqueViolations["folder.create"]) {
          forcedUniqueViolations["folder.create"] = false;
          throw makeUniqueConstraintError();
        }
        const now = new Date();
        const row: FakeFolderRow = {
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          ...data
        };
        folders.push(row);
        return row;
      },
      async update({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<CreateFolderData>;
      }) {
        if (forcedUniqueViolations["folder.update"]) {
          forcedUniqueViolations["folder.update"] = false;
          throw makeUniqueConstraintError();
        }
        const row = folders.find((folder) => folder.id === where.id);
        if (!row) {
          throw new Error(`fake-prisma: folder ${where.id} not found`);
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      async delete({ where }: { where: { id: string } }) {
        const index = folders.findIndex((folder) => folder.id === where.id);
        if (index === -1) {
          throw new Error(`fake-prisma: folder ${where.id} not found`);
        }
        const [row] = folders.splice(index, 1);
        return row;
      }
    },
    // Simulates Prisma's interactive-transaction rollback semantics: if
    // `fn` throws, every mutation it made to any of these four in-memory
    // collections is undone before the error propagates, so a caller can
    // never observe a partially-applied transaction — matching what a
    // real Postgres transaction guarantees.
    async $transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
      const usersSnapshot = users.map((row) => ({ ...row }));
      const vaultsSnapshot = vaults.map((row) => ({ ...row }));
      const filesSnapshot = files.map((row) => ({ ...row }));
      const foldersSnapshot = folders.map((row) => ({ ...row }));
      try {
        return await fn(fake as unknown as PrismaClient);
      } catch (error) {
        users.length = 0;
        users.push(...usersSnapshot);
        vaults.length = 0;
        vaults.push(...vaultsSnapshot);
        files.length = 0;
        files.push(...filesSnapshot);
        folders.length = 0;
        folders.push(...foldersSnapshot);
        throw error;
      }
    }
  };

  return {
    prisma: fake as unknown as PrismaClient,
    vaults,
    files,
    folders,
    users,
    forceVaultUpdateFailureFor(vaultId: string | null) {
      forcedVaultUpdateFailureId = vaultId;
    },
    forceNextUniqueViolation(
      target: "file.create" | "file.update" | "folder.create" | "folder.update"
    ) {
      forcedUniqueViolations[target] = true;
    }
  };
}
