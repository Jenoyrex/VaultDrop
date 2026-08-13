import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * A minimal in-memory stand-in for `PrismaClient`, covering only the
 * subset of calls the file-upload path actually makes (vault ownership
 * lookup, duplicate-name check, file creation). Used so the upload route
 * integration tests don't require a live Postgres instance. Not a general
 * Prisma mock — extend the covered surface only if a test genuinely needs
 * a call this doesn't yet support.
 */

export interface FakeVaultRow {
  id: string;
  ownerId: string;
  name: string;
}

export interface FakeFileRow {
  id: string;
  name: string;
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
}

type CreateFileData = Omit<FakeFileRow, "id" | "createdAt" | "updatedAt">;

export function createFakePrisma(seedVaults: FakeVaultRow[]): {
  prisma: PrismaClient;
  files: FakeFileRow[];
} {
  const vaults = [...seedVaults];
  const files: FakeFileRow[] = [];

  const fake = {
    vault: {
      async findUnique({ where }: { where: { id: string } }) {
        return vaults.find((vault) => vault.id === where.id) ?? null;
      }
    },
    file: {
      async findFirst({
        where
      }: {
        where: { vaultId: string; folderId: string | null; name: string };
      }) {
        return (
          files.find(
            (file) =>
              file.vaultId === where.vaultId &&
              file.folderId === where.folderId &&
              file.name === where.name
          ) ?? null
        );
      },
      async findUnique({ where }: { where: { id: string } }) {
        return files.find((file) => file.id === where.id) ?? null;
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
      }
    }
  };

  return { prisma: fake as unknown as PrismaClient, files };
}
