import { randomUUID, webcrypto } from "node:crypto";
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

const { subtle } = webcrypto;

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

/**
 * Builds a ciphertext blob in exactly the wire format
 * `encryptFileStreamWithEmbeddedNonce` (apps/web/src/lib/crypto) produces:
 * a 12-byte random base nonce, followed by one `[4-byte length][ciphertext
 * +tag]` framed chunk. Mirrors the helper in upload.test.ts.
 */
async function buildEncryptedFixture(
  plaintext: Buffer,
  fileKey: webcrypto.CryptoKey
): Promise<Buffer> {
  const baseNonce = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv: baseNonce }, fileKey, plaintext)
  );
  const lengthPrefix = Buffer.alloc(4);
  lengthPrefix.writeUInt32BE(ciphertext.length, 0);
  return Buffer.concat([Buffer.from(baseNonce), lengthPrefix, Buffer.from(ciphertext)]);
}

async function decryptFixture(onDisk: Buffer, fileKey: webcrypto.CryptoKey): Promise<Buffer> {
  const baseNonce = onDisk.subarray(0, 12);
  const length = onDisk.readUInt32BE(12);
  const ciphertext = onDisk.subarray(16, 16 + length);
  const plaintext = await subtle.decrypt(
    { name: "AES-GCM", iv: baseNonce },
    fileKey,
    ciphertext
  );
  return Buffer.from(plaintext);
}

function bearerTokenFor(ownerId: string): string {
  return signAccessToken({
    userId: ownerId,
    username: "tester",
    secret: TEST_ENV.JWT_SECRET,
    expiresIn: TEST_ENV.JWT_EXPIRES_IN
  });
}

describe("file download/preview routes", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vaultdrop-download-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function uploadEncrypted(
    app: ReturnType<typeof createApp>,
    token: string,
    vaultId: string,
    opts: { name: string; mimeType: string; plaintext: Buffer; fileKey: webcrypto.CryptoKey }
  ) {
    const wireBytes = await buildEncryptedFixture(opts.plaintext, opts.fileKey);

    // Stand-in ciphertext for the name — these tests exercise
    // download/preview behavior, not real name encryption, so a
    // deterministic base64 encoding of the plaintext name is a
    // convenient (not cryptographically meaningful) fixture here.
    const params = new URLSearchParams({
      vaultId,
      encryptedName: Buffer.from(opts.name).toString("base64"),
      nameIv: Buffer.from("fake-name-iv").toString("base64"),
      mimeType: opts.mimeType,
      encryptionVersion: "1",
      wrappedKeyCiphertext: Buffer.from("fake-wrapped-file-key").toString("base64"),
      wrappedKeyIv: Buffer.from("fake-iv-value").toString("base64")
    });

    const response = await request(app)
      .post(`/files/upload-encrypted?${params.toString()}`)
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/octet-stream")
      .send(wireBytes);

    expect(response.status).toBe(201);
    return { file: response.body.file as { id: string }, wireBytes };
  }

  describe("GET /files/:fileId/download", () => {
    it("serves an encrypted file as opaque octet-stream ciphertext, byte-identical to what was uploaded, decryptable back to the original plaintext", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([{ id: vaultId, ownerId, name: "Test Vault" }]);
      const storage = new LocalStorageAdapter(tmpDir);
      const app = createApp(prisma, TEST_ENV, storage);
      const token = bearerTokenFor(ownerId);

      const fileKey = await subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );

      const marker = "THIS-IS-A-SECRET-MARKER-cp5-download";
      const plaintext = Buffer.from(`preamble\n${marker}\npostamble`, "utf8");

      const { file: uploaded, wireBytes } = await uploadEncrypted(app, token, vaultId, {
        name: "secret.png",
        mimeType: "image/png",
        plaintext,
        fileKey
      });

      const response = await request(app)
        .get(`/files/${uploaded.id}/download`)
        .set("Authorization", `Bearer ${token}`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => callback(null, Buffer.concat(chunks)));
        });

      expect(response.status).toBe(200);
      // Never labeled with the real (image/png) mime type, and never
      // presented as inline-renderable — it's ciphertext, not an image.
      expect(response.headers["content-type"]).toBe("application/octet-stream");
      expect(response.headers["content-disposition"]).toContain("attachment");

      const body = response.body as Buffer;
      expect(body.includes(marker)).toBe(false);
      expect(body.equals(wireBytes)).toBe(true);

      const decrypted = await decryptFixture(body, fileKey);
      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it("serves a legacy plaintext file exactly as before: real mime type, attachment disposition, unmodified bytes", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([{ id: vaultId, ownerId, name: "Test Vault" }]);
      const storage = new LocalStorageAdapter(tmpDir);
      const app = createApp(prisma, TEST_ENV, storage);
      const token = bearerTokenFor(ownerId);

      const plaintext = Buffer.from("hello, this is a plain legacy file", "utf8");

      const uploadResponse = await request(app)
        .post(`/files/upload?vaultId=${vaultId}`)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", plaintext, "hello.txt");

      expect(uploadResponse.status).toBe(201);
      const fileId = uploadResponse.body.file.id as string;

      const response = await request(app)
        .get(`/files/${fileId}/download`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("text/plain");
      expect(response.headers["content-disposition"]).toContain("attachment");
      expect(Buffer.from(response.text).equals(plaintext)).toBe(true);
    });
  });

  describe("GET /files/:fileId/preview", () => {
    it("serves an encrypted (previewable-mime-type) file as opaque octet-stream ciphertext, as an attachment rather than inline", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([{ id: vaultId, ownerId, name: "Test Vault" }]);
      const storage = new LocalStorageAdapter(tmpDir);
      const app = createApp(prisma, TEST_ENV, storage);
      const token = bearerTokenFor(ownerId);

      const fileKey = await subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );

      const plaintext = Buffer.from("fake-png-bytes", "utf8");

      const { file: uploaded } = await uploadEncrypted(app, token, vaultId, {
        name: "photo.png",
        mimeType: "image/png",
        plaintext,
        fileKey
      });

      const response = await request(app)
        .get(`/files/${uploaded.id}/preview`)
        .set("Authorization", `Bearer ${token}`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => callback(null, Buffer.concat(chunks)));
        });

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("application/octet-stream");
      expect(response.headers["content-disposition"]).toContain("attachment");
      expect(response.headers["content-disposition"]).not.toContain("inline");
    });

    it("serves a legacy previewable file inline with its real mime type, unchanged", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([{ id: vaultId, ownerId, name: "Test Vault" }]);
      const storage = new LocalStorageAdapter(tmpDir);
      const app = createApp(prisma, TEST_ENV, storage);
      const token = bearerTokenFor(ownerId);

      const plaintext = Buffer.from("{}", "utf8");

      const uploadResponse = await request(app)
        .post(`/files/upload?vaultId=${vaultId}`)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", plaintext, {
          filename: "data.json",
          contentType: "application/json"
        });

      expect(uploadResponse.status).toBe(201);
      const fileId = uploadResponse.body.file.id as string;

      const response = await request(app)
        .get(`/files/${fileId}/preview`)
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.headers["content-disposition"]).toContain("inline");
    });
  });
});
