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

const BASE_ENV: ServerEnv = {
  NODE_ENV: "test",
  PORT: 4000,
  DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
  JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
  JWT_EXPIRES_IN: "15m",
  STORAGE_DRIVER: "local",
  STORAGE_ROOT: "./unused",
  CORS_ORIGIN: "http://localhost:3000",
  MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
  // Deliberately small budgets so these tests exhaust them quickly.
  API_RATE_LIMIT_WINDOW_MS: 60_000,
  API_RATE_LIMIT_MAX: 3,
  UPLOAD_RATE_LIMIT_MAX: 2,
  DOWNLOAD_RATE_LIMIT_MAX: 2
};

function bearerTokenFor(ownerId: string, username = "tester"): string {
  return signAccessToken({
    userId: ownerId,
    username,
    secret: BASE_ENV.JWT_SECRET,
    expiresIn: BASE_ENV.JWT_EXPIRES_IN
  });
}

function encryptedUploadParams(vaultId: string, suffix: string) {
  return new URLSearchParams({
    vaultId,
    encryptedName: Buffer.from(`name-${suffix}`).toString("base64"),
    nameIv: Buffer.from("iv").toString("base64"),
    mimeType: "text/plain",
    encryptionVersion: "1",
    wrappedKeyCiphertext: Buffer.from("key").toString("base64"),
    wrappedKeyIv: Buffer.from("iv").toString("base64")
  });
}

describe("API rate limiting (general / upload / download)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vaultdrop-api-rate-limit-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeApp(env: ServerEnv = BASE_ENV) {
    const built = createFakePrisma();
    const app = createApp(built.prisma, env, new LocalStorageAdapter(tmpDir));
    return { app, ...built };
  }

  describe("general API limiter", () => {
    it("enforces ONE shared budget across /vaults, /folders, and /files combined, per user", async () => {
      const { app } = makeApp();
      const ownerId = randomUUID();
      const token = bearerTokenFor(ownerId);

      // Budget is 3. Spend it across three DIFFERENT routers, not just one.
      await request(app).get("/vaults").set("Authorization", `Bearer ${token}`).expect(200);
      await request(app)
        .get("/folders/contents?vaultId=" + randomUUID())
        .set("Authorization", `Bearer ${token}`)
        .expect(404); // vault doesn't exist, but it still counts as a request
      await request(app).get("/files?vaultId=" + randomUUID()).set("Authorization", `Bearer ${token}`).expect(404);

      // A 4th request, on yet another router, is rejected — proving the
      // budget is one shared counter across all three routers, not one
      // independent 3-request budget per router (which would still allow
      // this to succeed).
      const limited = await request(app)
        .get("/vaults")
        .set("Authorization", `Bearer ${token}`);
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe("RATE_LIMITED");
    });

    it("is keyed per user — exhausting one user's budget doesn't affect another", async () => {
      const { app } = makeApp();
      const tokenA = bearerTokenFor(randomUUID());
      const tokenB = bearerTokenFor(randomUUID());

      for (let i = 0; i < 3; i++) {
        await request(app).get("/vaults").set("Authorization", `Bearer ${tokenA}`).expect(200);
      }
      const limitedA = await request(app).get("/vaults").set("Authorization", `Bearer ${tokenA}`);
      expect(limitedA.status).toBe(429);

      const stillOkB = await request(app).get("/vaults").set("Authorization", `Bearer ${tokenB}`);
      expect(stillOkB.status).toBe(200);
    });
  });

  describe("upload limiter", () => {
    it("rejects before the request body is consumed or storage is touched, once the shared upload budget is exceeded", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const seeded = createFakePrisma([{ id: vaultId, ownerId, name: "Vault" }]);
      const app = createApp(seeded.prisma, BASE_ENV, new LocalStorageAdapter(tmpDir));
      const token = bearerTokenFor(ownerId);

      // Budget is 2, shared between /upload and /upload-encrypted.
      await request(app)
        .post(`/files/upload-encrypted?${encryptedUploadParams(vaultId, "1").toString()}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/octet-stream")
        .send(Buffer.from("ciphertext-1"))
        .expect(201);

      await request(app)
        .post(`/files/upload?vaultId=${vaultId}`)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", Buffer.from("legacy plaintext"), "hello.txt")
        .expect(201);

      expect(seeded.files.length).toBe(2);

      // 3rd upload attempt (either route) is rejected before any bytes are
      // stored — the fake prisma's `files` array must not grow.
      const rejected = await request(app)
        .post(`/files/upload-encrypted?${encryptedUploadParams(vaultId, "3").toString()}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/octet-stream")
        .send(Buffer.from("ciphertext-3"));

      expect(rejected.status).toBe(429);
      expect(seeded.files.length).toBe(2);
    });

    it("/upload and /upload-encrypted share one budget, not two independent ones", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const seeded = createFakePrisma([{ id: vaultId, ownerId, name: "Vault" }]);
      const app = createApp(seeded.prisma, BASE_ENV, new LocalStorageAdapter(tmpDir));
      const token = bearerTokenFor(ownerId);

      // Spend the whole budget (2) on the legacy /upload route alone.
      await request(app)
        .post(`/files/upload?vaultId=${vaultId}`)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", Buffer.from("a"), "a.txt")
        .expect(201);
      await request(app)
        .post(`/files/upload?vaultId=${vaultId}`)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", Buffer.from("b"), "b.txt")
        .expect(201);

      // The encrypted route is now rejected too, despite never having been
      // called before in this test — proves one shared counter.
      const rejected = await request(app)
        .post(`/files/upload-encrypted?${encryptedUploadParams(vaultId, "c").toString()}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/octet-stream")
        .send(Buffer.from("c"));

      expect(rejected.status).toBe(429);
    });
  });

  describe("download/preview limiter", () => {
    async function seedOneEncryptedFile() {
      // Generous general budget, isolated from the tight download budget
      // for the same reason as the "independence" test below — every
      // download/preview call also consumes from the general budget
      // (layered underneath), and a tight general budget here would
      // exhaust at the same moment as the download budget, making it
      // ambiguous which limiter actually caused a given rejection.
      const env: ServerEnv = { ...BASE_ENV, API_RATE_LIMIT_MAX: 20 };
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const seeded = createFakePrisma([{ id: vaultId, ownerId, name: "Vault" }]);
      const app = createApp(seeded.prisma, env, new LocalStorageAdapter(tmpDir));
      const token = bearerTokenFor(ownerId);

      const uploadRes = await request(app)
        .post(`/files/upload-encrypted?${encryptedUploadParams(vaultId, "dl").toString()}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/octet-stream")
        .send(Buffer.from("ciphertext"));
      expect(uploadRes.status).toBe(201);

      return { app, token, fileId: uploadRes.body.file.id as string };
    }

    it("/download and /preview share one budget, and rejection happens before opening a storage read stream", async () => {
      const { app, token, fileId } = await seedOneEncryptedFile();

      // Budget is 2 — spend it with one download and one preview call.
      await request(app)
        .get(`/files/${fileId}/download`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      await request(app)
        .get(`/files/${fileId}/preview`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      // A 3rd call, to either route, is rejected — 404 would mean the
      // handler ran and looked up (and failed to find) something; 429
      // proves the limiter rejected before the handler (and therefore
      // before fileService.getFileStream / any storage read) ever ran.
      const rejected = await request(app)
        .get(`/files/${fileId}/download`)
        .set("Authorization", `Bearer ${token}`);
      expect(rejected.status).toBe(429);
      expect(rejected.body.error.code).toBe("RATE_LIMITED");
    });
  });

  describe("independence between the three budgets", () => {
    it("exhausting the upload budget does not affect the general or download budgets", async () => {
      // A generous general budget here, deliberately separate from the
      // tight default used elsewhere in this file — every request to
      // /files (including upload attempts) also consumes from the general
      // budget, since it's layered underneath; keeping it generous is what
      // lets this test isolate and prove upload-budget exhaustion
      // specifically, rather than incidentally exhausting the general one
      // as a side effect of the same requests.
      const env: ServerEnv = { ...BASE_ENV, API_RATE_LIMIT_MAX: 20 };
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const seeded = createFakePrisma([{ id: vaultId, ownerId, name: "Vault" }]);
      const app = createApp(seeded.prisma, env, new LocalStorageAdapter(tmpDir));
      const token = bearerTokenFor(ownerId);

      // Exhaust the upload budget (2).
      for (let i = 0; i < 2; i++) {
        await request(app)
          .post(`/files/upload-encrypted?${encryptedUploadParams(vaultId, String(i)).toString()}`)
          .set("Authorization", `Bearer ${token}`)
          .set("Content-Type", "application/octet-stream")
          .send(Buffer.from(`c-${i}`))
          .expect(201);
      }
      const uploadRejected = await request(app)
        .post(`/files/upload-encrypted?${encryptedUploadParams(vaultId, "x").toString()}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/octet-stream")
        .send(Buffer.from("x"));
      expect(uploadRejected.status).toBe(429);

      // The general-API budget (20, only ~3 of it spent so far by the
      // requests above) still has plenty of room.
      const listRes = await request(app).get("/vaults").set("Authorization", `Bearer ${token}`);
      expect(listRes.status).toBe(200);

      // The download budget is a fully separate counter and is untouched.
      const uploadedFileId = (
        await request(app)
          .get(`/files?vaultId=${vaultId}`)
          .set("Authorization", `Bearer ${token}`)
      ).body.files[0].id as string;
      const downloadRes = await request(app)
        .get(`/files/${uploadedFileId}/download`)
        .set("Authorization", `Bearer ${token}`);
      expect(downloadRes.status).toBe(200);
    });
  });

  describe("interaction with TRUST_PROXY_HOPS / X-Forwarded-For", () => {
    it("per-user keying is unaffected by X-Forwarded-For, regardless of TRUST_PROXY_HOPS", async () => {
      const env: ServerEnv = { ...BASE_ENV, TRUST_PROXY_HOPS: 1 };
      const { app } = makeApp(env);
      const token = bearerTokenFor(randomUUID());

      // Same user token, three requests each claiming a DIFFERENT forwarded
      // client IP. If keying were (incorrectly) falling back to IP, these
      // would look like three different clients and none would be
      // rate-limited. Since keying is by req.user.sub, they must still
      // share one budget (3) and the 4th is rejected.
      await request(app)
        .get("/vaults")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", "203.0.113.1")
        .expect(200);
      await request(app)
        .get("/vaults")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", "203.0.113.2")
        .expect(200);
      await request(app)
        .get("/vaults")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", "203.0.113.3")
        .expect(200);

      const limited = await request(app)
        .get("/vaults")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", "203.0.113.4");
      expect(limited.status).toBe(429);
    });
  });
});
