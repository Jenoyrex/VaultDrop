import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

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

export function createFakePrisma(seedVaults: SeedVaultRow[]): {
  prisma: PrismaClient;
  vaults: FakeVaultRow[];
  files: FakeFileRow[];
  folders: FakeFolderRow[];
} {
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

  const fake = {
    vault: {
      async findUnique({ where }: { where: { id: string } }) {
        return vaults.find((vault) => vault.id === where.id) ?? null;
      },
      async update({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<Omit<FakeVaultRow, "id" | "ownerId">>;
      }) {
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
    }
  };

  return { prisma: fake as unknown as PrismaClient, vaults, files, folders };
}
