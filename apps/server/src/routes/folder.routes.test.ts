import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import type { ServerEnv } from "@vaultdrop/config";
import type { StorageAdapter } from "@vaultdrop/types";
import { signAccessToken } from "@vaultdrop/crypto";
import { createApp } from "../app.js";
import { createFakePrisma } from "../test-support/fake-prisma.js";

/**
 * Cross-user authorization (IDOR) regression tests for the folder routes.
 * `FolderService` already scopes every lookup through
 * `VaultService.getOwnedVaultOrThrow`/`FolderService.getFolderOrThrow`
 * (see folder.service.ts); these tests exercise that boundary through the
 * actual HTTP routes — User A creates a vault and a folder, User B (a
 * separate, otherwise-valid, authenticated account) attempts to read,
 * create into, rename, or delete it — so a future regression here is
 * caught by CI rather than by inspection alone.
 */

const TEST_ENV: ServerEnv = {
  NODE_ENV: "test",
  PORT: 4000,
  DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
  JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
  JWT_EXPIRES_IN: "15m",
  STORAGE_DRIVER: "local",
  STORAGE_ROOT: "./unused",
  CORS_ORIGIN: "http://localhost:3000",
  MAX_UPLOAD_BYTES: 100 * 1024 * 1024
};

// Folder routes never touch storage — any accidental storage access fails
// the test loudly instead of silently succeeding against a real filesystem.
const unusedStorage: StorageAdapter = {
  put: () => {
    throw new Error("not used by folder routes");
  },
  putStream: () => {
    throw new Error("not used by folder routes");
  },
  get: () => {
    throw new Error("not used by folder routes");
  },
  getStream: () => {
    throw new Error("not used by folder routes");
  },
  delete: () => {
    throw new Error("not used by folder routes");
  },
  exists: () => {
    throw new Error("not used by folder routes");
  }
};

function bearerTokenFor(ownerId: string): string {
  return signAccessToken({
    userId: ownerId,
    username: "tester",
    secret: TEST_ENV.JWT_SECRET,
    expiresIn: TEST_ENV.JWT_EXPIRES_IN
  });
}

async function setupUserAWithFolder() {
  const userA = randomUUID();
  const userB = randomUUID();
  const vaultId = randomUUID();
  const { prisma, folders } = createFakePrisma([
    { id: vaultId, ownerId: userA, name: "User A's Vault" }
  ]);
  const app = createApp(prisma, TEST_ENV, unusedStorage);
  const tokenA = bearerTokenFor(userA);
  const tokenB = bearerTokenFor(userB);

  const createRes = await request(app)
    .post("/folders")
    .set("Authorization", `Bearer ${tokenA}`)
    .send({ vaultId, parentId: null, name: "User A's Folder" });
  expect(createRes.status).toBe(201);
  const folderId = createRes.body.folder.id as string;

  return { app, vaultId, folderId, tokenA, tokenB, folders };
}

describe("cross-user authorization on /folders", () => {
  it("POST /folders: User B is forbidden from creating a folder inside User A's vault, and nothing is created", async () => {
    const { app, vaultId, tokenB, folders } = await setupUserAWithFolder();
    const countBefore = folders.length;

    const res = await request(app)
      .post("/folders")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ vaultId, parentId: null, name: "Intrusion" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(folders).toHaveLength(countBefore);
  });

  it("GET /folders/contents: User B is forbidden from listing User A's vault contents", async () => {
    const { app, vaultId, tokenB } = await setupUserAWithFolder();

    const res = await request(app)
      .get(`/folders/contents?vaultId=${vaultId}`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("GET /folders/search: User B is forbidden from searching User A's vault", async () => {
    const { app, vaultId, tokenB } = await setupUserAWithFolder();

    const res = await request(app)
      .get(`/folders/search?vaultId=${vaultId}&query=folder`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("PATCH /folders/:folderId: User B is forbidden from renaming User A's folder, and the name is unchanged", async () => {
    const { app, folderId, tokenB, folders } = await setupUserAWithFolder();

    const res = await request(app)
      .patch(`/folders/${folderId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "Renamed By Attacker" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");

    const row = folders.find((f) => f.id === folderId);
    expect(row?.name).toBe("User A's Folder");
  });

  it("DELETE /folders/:folderId: User B is forbidden from deleting User A's folder, and it is not removed", async () => {
    const { app, folderId, tokenB, folders } = await setupUserAWithFolder();

    const res = await request(app)
      .delete(`/folders/${folderId}`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(folders.some((f) => f.id === folderId)).toBe(true);
  });

  it("control case: User A can still rename and delete their own folder", async () => {
    const { app, folderId, tokenA, folders } = await setupUserAWithFolder();

    const renameRes = await request(app)
      .patch(`/folders/${folderId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Renamed By Owner" });
    expect(renameRes.status).toBe(200);

    const deleteRes = await request(app)
      .delete(`/folders/${folderId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(deleteRes.status).toBe(204);
    expect(folders.some((f) => f.id === folderId)).toBe(false);
  });
});
