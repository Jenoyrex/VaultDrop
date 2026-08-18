import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { ServerEnv } from "@vaultdrop/config";
import { signAccessToken } from "@vaultdrop/crypto";
import { createApp } from "../app.js";
import { LocalStorageAdapter } from "../storage/local-storage-adapter.js";
import { createFakePrisma } from "../test-support/fake-prisma.js";

/**
 * Cross-user authorization (IDOR) regression tests for the file routes.
 * `FileService` already scopes every lookup through
 * `VaultService.getOwnedVaultOrThrow` (see `FileService.getFileOrThrow`
 * in file.service.ts); these tests exercise that boundary through the
 * actual HTTP routes — User A creates a vault and uploads a file, User B
 * (a separate, otherwise-valid, authenticated account) attempts to read,
 * rename, delete, download, or preview it — so a future regression here
 * is caught by CI rather than by inspection alone.
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

function bearerTokenFor(ownerId: string): string {
  return signAccessToken({
    userId: ownerId,
    username: "tester",
    secret: TEST_ENV.JWT_SECRET,
    expiresIn: TEST_ENV.JWT_EXPIRES_IN
  });
}

describe("cross-user authorization on /files", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vaultdrop-file-idor-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function setupUserAWithFile() {
    const userA = randomUUID();
    const userB = randomUUID();
    const vaultId = randomUUID();
    const { prisma, files } = createFakePrisma([
      { id: vaultId, ownerId: userA, name: "User A's Vault" }
    ]);
    const storage = new LocalStorageAdapter(tmpDir);
    const app = createApp(prisma, TEST_ENV, storage);
    const tokenA = bearerTokenFor(userA);
    const tokenB = bearerTokenFor(userB);

    const plaintext = Buffer.from("User A's private content", "utf8");
    const uploadRes = await request(app)
      .post(`/files/upload?vaultId=${vaultId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .attach("file", plaintext, "secret.txt");
    expect(uploadRes.status).toBe(201);
    const fileId = uploadRes.body.file.id as string;

    return { app, vaultId, fileId, tokenA, tokenB, files, plaintext };
  }

  it("GET /files/:fileId: User B is forbidden from reading User A's file metadata", async () => {
    const { app, fileId, tokenB } = await setupUserAWithFile();

    const res = await request(app)
      .get(`/files/${fileId}`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("PATCH /files/:fileId: User B is forbidden from renaming User A's file, and the name is unchanged", async () => {
    const { app, fileId, tokenB, files } = await setupUserAWithFile();

    const res = await request(app)
      .patch(`/files/${fileId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "renamed-by-attacker.txt" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");

    const row = files.find((f) => f.id === fileId);
    expect(row?.name).toBe("secret.txt");
  });

  it("DELETE /files/:fileId: User B is forbidden from deleting User A's file, and neither the DB row nor the storage object is removed", async () => {
    const { app, fileId, tokenA, tokenB, files } = await setupUserAWithFile();

    const res = await request(app)
      .delete(`/files/${fileId}`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(files.some((f) => f.id === fileId)).toBe(true);

    // The storage object is still intact too — proven by the real owner
    // still being able to download it afterward.
    const downloadRes = await request(app)
      .get(`/files/${fileId}/download`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.text).toBe("User A's private content");
  });

  it("GET /files/:fileId/download: User B is forbidden from downloading User A's file content", async () => {
    const { app, fileId, tokenB } = await setupUserAWithFile();

    const res = await request(app)
      .get(`/files/${fileId}/download`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    // The rejection body must never carry the file's content.
    expect(JSON.stringify(res.body)).not.toContain("private content");
  });

  it("GET /files/:fileId/preview: User B is forbidden from previewing User A's file content", async () => {
    const { app, fileId, tokenB } = await setupUserAWithFile();

    const res = await request(app)
      .get(`/files/${fileId}/preview`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(JSON.stringify(res.body)).not.toContain("private content");
  });

  it("control case: User A can still read, download, and delete their own file", async () => {
    const { app, fileId, tokenA, files } = await setupUserAWithFile();

    const metaRes = await request(app)
      .get(`/files/${fileId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(metaRes.status).toBe(200);

    const downloadRes = await request(app)
      .get(`/files/${fileId}/download`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(downloadRes.status).toBe(200);

    const deleteRes = await request(app)
      .delete(`/files/${fileId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(deleteRes.status).toBe(204);
    expect(files.some((f) => f.id === fileId)).toBe(false);
  });

  it("a nonexistent file id is 404, not 403, for any authenticated user", async () => {
    const { app, tokenB } = await setupUserAWithFile();

    const res = await request(app)
      .get(`/files/${randomUUID()}`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });
});
