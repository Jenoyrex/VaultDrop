import { randomUUID, webcrypto } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { ServerEnv } from "@vaultdrop/config";
import { signAccessToken } from "@vaultdrop/crypto";
import { createApp } from "../app.js";
import { LocalStorageAdapter } from "../storage/local-storage-adapter.js";
import { CloudStorageAdapter } from "../storage/cloud-storage-adapter.js";
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
 * a 12-byte base nonce, followed by one `[4-byte length][ciphertext+tag]`
 * framed chunk. Hand-rolled here with Node's built-in WebCrypto rather
 * than importing from apps/web, since there's no workspace dependency
 * edge from apps/server to apps/web.
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

describe("file upload routes", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vaultdrop-upload-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("POST /files/upload-encrypted", () => {
    it("persists ciphertext only: the plaintext marker never lands on disk, the stored bytes are exactly what was sent, and they decrypt back to the original plaintext with the (never-transmitted) file key", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([
        { id: vaultId, ownerId, name: "Test Vault" }
      ]);
      const storage = new LocalStorageAdapter(tmpDir);
      const app = createApp(prisma, TEST_ENV, storage);
      const token = bearerTokenFor(ownerId);

      const fileKey = await subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );

      const marker = "THIS-IS-A-SECRET-MARKER-8f3c9a1e";
      const plaintext = Buffer.from(`preamble\n${marker}\npostamble`, "utf8");
      const wireBytes = await buildEncryptedFixture(plaintext, fileKey);

      const wrappedKeyCiphertext = Buffer.from("fake-wrapped-file-key").toString(
        "base64"
      );
      const wrappedKeyIv = Buffer.from("fake-iv-value").toString("base64");
      // Stand-ins for the client-encrypted name — this test doesn't
      // exercise real name encryption, just that the server stores and
      // returns whatever ciphertext it's given without ever seeing a
      // plaintext name (see the dedicated encrypted-name tests).
      const encryptedName = Buffer.from("fake-encrypted-name").toString("base64");
      const nameIv = Buffer.from("fake-name-iv").toString("base64");

      const params = new URLSearchParams({
        vaultId,
        encryptedName,
        nameIv,
        mimeType: "text/plain",
        encryptionVersion: "1",
        wrappedKeyCiphertext,
        wrappedKeyIv
      });

      const response = await request(app)
        .post(`/files/upload-encrypted?${params.toString()}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/octet-stream")
        .send(wireBytes);

      expect(response.status).toBe(201);
      expect(response.body.file.encrypted).toBe(true);
      expect(response.body.file.wrappedKeyCiphertext).toBe(wrappedKeyCiphertext);
      expect(response.body.file.wrappedKeyIv).toBe(wrappedKeyIv);
      expect(response.body.file.encryptedName).toBe(encryptedName);
      expect(response.body.file.nameIv).toBe(nameIv);
      // The server never receives a plaintext name for an encrypted
      // upload, so `name` must stay null — never a placeholder derived
      // from anything client-supplied.
      expect(response.body.file.name).toBeNull();

      const storageKey = response.body.file.storageKey as string;
      const onDisk = await readFile(join(tmpDir, storageKey));

      // The core proof: what physically landed on disk never contains the
      // plaintext marker...
      expect(onDisk.includes(marker)).toBe(false);
      expect(onDisk.equals(wireBytes)).toBe(true);

      // ...and it's the *correct* ciphertext — decrypting it with the
      // original file key (which was never sent to the server) recovers
      // the exact original plaintext.
      const decrypted = await decryptFixture(onDisk, fileKey);
      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it("rejects an upload into a vault the caller doesn't own", async () => {
      const ownerId = randomUUID();
      const otherOwnerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([
        { id: vaultId, ownerId: otherOwnerId, name: "Someone else's vault" }
      ]);
      const storage = new LocalStorageAdapter(tmpDir);
      const app = createApp(prisma, TEST_ENV, storage);
      const token = bearerTokenFor(ownerId);

      const params = new URLSearchParams({
        vaultId,
        encryptedName: "abc",
        nameIv: "def",
        mimeType: "text/plain",
        encryptionVersion: "1",
        wrappedKeyCiphertext: "abc",
        wrappedKeyIv: "def"
      });

      const response = await request(app)
        .post(`/files/upload-encrypted?${params.toString()}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/octet-stream")
        .send(Buffer.from("irrelevant"));

      expect(response.status).toBe(403);
    });
  });

  describe("POST /files/upload (legacy, plaintext) — baseline regression", () => {
    it("still stores plaintext as-is and returns encrypted: false", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([
        { id: vaultId, ownerId, name: "Test Vault" }
      ]);
      const storage = new LocalStorageAdapter(tmpDir);
      const app = createApp(prisma, TEST_ENV, storage);
      const token = bearerTokenFor(ownerId);

      const plaintext = Buffer.from("hello, this is a plain legacy file", "utf8");

      const response = await request(app)
        .post(`/files/upload?vaultId=${vaultId}`)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", plaintext, "hello.txt");

      expect(response.status).toBe(201);
      expect(response.body.file.encrypted).toBe(false);
      expect(response.body.file.wrappedKeyCiphertext).toBeNull();
      expect(response.body.file.wrappedKeyIv).toBeNull();

      const storageKey = response.body.file.storageKey as string;
      const onDisk = await readFile(join(tmpDir, storageKey));
      expect(onDisk.equals(plaintext)).toBe(true);
    });
  });
});

describe("POST /files/upload-encrypted against a real CloudStorageAdapter (regression: oversized upload must fail cleanly, not hang)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    "rejects an oversized encrypted upload with 400 instead of hanging indefinitely",
    async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([
        { id: vaultId, ownerId, name: "Test Vault" }
      ]);

      // A real CloudStorageAdapter/S3Client/Upload — no mocking of
      // putStream itself, so this genuinely exercises the fixed code
      // path. It never reaches the network: the oversized-body guard in
      // file.routes.ts errors the request stream before enough bytes
      // accumulate for `Upload` to attempt a `client.send()` call, which
      // is exactly the scenario that used to hang indefinitely (see
      // cloud-storage-adapter.ts's `putStream`). `delete` is stubbed out
      // only because the route's unrelated error-cleanup path would
      // otherwise issue a real DeleteObjectCommand network call here —
      // that cleanup call is incidental to this test, not the behavior
      // under test.
      const storage = new CloudStorageAdapter({ bucket: "test-bucket", region: "us-east-1" });
      vi.spyOn(storage, "delete").mockResolvedValue(undefined);

      const smallLimitEnv: ServerEnv = { ...TEST_ENV, STORAGE_DRIVER: "cloud", MAX_UPLOAD_BYTES: 1000 };
      const app = createApp(prisma, smallLimitEnv, storage);
      const token = bearerTokenFor(ownerId);

      const oversizedBody = Buffer.alloc(5000, 1);

      const params = new URLSearchParams({
        vaultId,
        encryptedName: "abc",
        nameIv: "def",
        mimeType: "application/octet-stream",
        encryptionVersion: "1",
        wrappedKeyCiphertext: "abc",
        wrappedKeyIv: "def"
      });

      const response = await request(app)
        .post(`/files/upload-encrypted?${params.toString()}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/octet-stream")
        .send(oversizedBody);

      expect(response.status).toBe(400);
      expect(response.body.error.message).toMatch(/exceeds the maximum upload size/i);
    },
    { timeout: 5000 }
  );
});
