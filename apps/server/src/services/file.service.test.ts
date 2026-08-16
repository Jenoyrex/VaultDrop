import { describe, expect, it } from "vitest";
import type { StorageAdapter, StorageObjectMeta, StoragePutInput } from "@vaultdrop/types";
import { FileService } from "./file.service.js";
import { createFakePrisma } from "../test-support/fake-prisma.js";

/**
 * Minimal in-memory `StorageAdapter` stand-in that just records which keys
 * were deleted, so tests can assert whether a race-condition cleanup
 * actually ran without touching real disk/bucket storage.
 */
function createFakeStorage(): StorageAdapter & { deletedKeys: string[] } {
  const deletedKeys: string[] = [];
  return {
    deletedKeys,
    async put(input: StoragePutInput): Promise<StorageObjectMeta> {
      return { key: input.key, sizeBytes: input.data.length, contentType: input.contentType };
    },
    async putStream(): Promise<StorageObjectMeta> {
      throw new Error("not used in these tests");
    },
    async get(): Promise<Buffer> {
      throw new Error("not used in these tests");
    },
    async getStream(): Promise<NodeJS.ReadableStream> {
      throw new Error("not used in these tests");
    },
    async delete(key: string): Promise<void> {
      deletedKeys.push(key);
    },
    async exists(): Promise<boolean> {
      return true;
    }
  };
}

const OWNER_ID = "owner-1";
const VAULT_ID = "vault-1";

function setup() {
  const { prisma, files, forceNextUniqueViolation } = createFakePrisma([
    { id: VAULT_ID, ownerId: OWNER_ID, name: "My Vault" }
  ]);
  const storage = createFakeStorage();
  const fileService = new FileService(prisma, storage, "LOCAL");
  return { prisma, files, storage, fileService, forceNextUniqueViolation };
}

describe("FileService.finalizeUpload — P2002 race handling", () => {
  it("finalizes a legacy (plaintext) upload normally when there is no conflict", async () => {
    const { fileService, storage } = setup();

    const file = await fileService.finalizeUpload({
      vaultId: VAULT_ID,
      folderId: null,
      originalName: "report.pdf",
      mimeType: "application/pdf",
      storageKey: "vault-1/abc",
      sizeBytes: 1234
    });

    expect(file.name).toBe("report.pdf");
    expect(storage.deletedKeys).toEqual([]);
  });

  it("translates a P2002 race on plaintext create to a 409 conflict and cleans up the orphaned storage object", async () => {
    const { fileService, storage, forceNextUniqueViolation } = setup();

    // Forcing the violation directly on `file.create` (rather than seeding
    // a colliding row and relying on a findFirst pre-check) exercises the
    // genuine TOCTOU race path: two concurrent uploads both pass
    // assertCanUpload's pre-check, and only the DB's unique index catches
    // the collision when the loser's create actually runs.
    forceNextUniqueViolation("file.create");

    const storageKey = "vault-1/race-storage-key";

    await expect(
      fileService.finalizeUpload({
        vaultId: VAULT_ID,
        folderId: null,
        originalName: "report.pdf",
        mimeType: "application/pdf",
        storageKey,
        sizeBytes: 1234
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });

    // The bytes were already written to storage before finalizeUpload ran
    // (mirroring the real upload routes) — the loser's orphaned object
    // must be cleaned up rather than leaked.
    expect(storage.deletedKeys).toEqual([storageKey]);
  });

  it("does not attempt storage cleanup for an encrypted upload's P2002 (no storage object is orphaned by name collisions)", async () => {
    const { fileService, storage, forceNextUniqueViolation } = setup();
    forceNextUniqueViolation("file.create");

    await expect(
      fileService.finalizeUpload({
        vaultId: VAULT_ID,
        folderId: null,
        encrypted: true,
        encryptedName: "ciphertext-name",
        nameIv: "iv",
        mimeType: "application/octet-stream",
        storageKey: "vault-1/encrypted-key",
        sizeBytes: 999,
        wrappedKeyCiphertext: "wrapped",
        wrappedKeyIv: "wrapped-iv"
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });

    expect(storage.deletedKeys).toEqual([]);
  });
});

describe("FileService.renameFile — P2002 race handling", () => {
  it("renames a legacy file normally when there is no conflict", async () => {
    const { fileService, files } = setup();
    files.push({
      id: "file-1",
      name: "a.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      vaultId: VAULT_ID,
      folderId: null,
      storageProvider: "LOCAL",
      storageKey: "vault-1/a",
      createdAt: new Date(),
      updatedAt: new Date(),
      encrypted: false,
      wrappedKeyCiphertext: null,
      wrappedKeyIv: null,
      encryptedName: null,
      nameIv: null
    });

    const renamed = await fileService.renameFile("file-1", OWNER_ID, { name: "b.txt" });

    expect(renamed.name).toBe("b.txt");
  });

  it("returns a clean 409 via the findFirst pre-check when the new name already exists", async () => {
    const { fileService, files } = setup();
    files.push(
      {
        id: "file-1",
        name: "a.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        vaultId: VAULT_ID,
        folderId: null,
        storageProvider: "LOCAL",
        storageKey: "vault-1/a",
        createdAt: new Date(),
        updatedAt: new Date(),
        encrypted: false,
        wrappedKeyCiphertext: null,
        wrappedKeyIv: null,
        encryptedName: null,
        nameIv: null
      },
      {
        id: "file-2",
        name: "b.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        vaultId: VAULT_ID,
        folderId: null,
        storageProvider: "LOCAL",
        storageKey: "vault-1/b",
        createdAt: new Date(),
        updatedAt: new Date(),
        encrypted: false,
        wrappedKeyCiphertext: null,
        wrappedKeyIv: null,
        encryptedName: null,
        nameIv: null
      }
    );

    await expect(
      fileService.renameFile("file-1", OWNER_ID, { name: "b.txt" })
    ).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });
  });

  it("translates a P2002 race on plaintext update to a 409 conflict (race path, not the pre-check)", async () => {
    const { fileService, files, forceNextUniqueViolation } = setup();
    files.push({
      id: "file-1",
      name: "a.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      vaultId: VAULT_ID,
      folderId: null,
      storageProvider: "LOCAL",
      storageKey: "vault-1/a",
      createdAt: new Date(),
      updatedAt: new Date(),
      encrypted: false,
      wrappedKeyCiphertext: null,
      wrappedKeyIv: null,
      encryptedName: null,
      nameIv: null
    });

    // No colliding row exists, so the findFirst pre-check passes — the
    // conflict is only surfaced because the DB update itself is forced to
    // throw P2002, simulating a concurrent rename that landed first.
    forceNextUniqueViolation("file.update");

    await expect(
      fileService.renameFile("file-1", OWNER_ID, { name: "c.txt" })
    ).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });
  });
});
