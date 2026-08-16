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
 * Hand-rolled equivalent of `apps/web/src/lib/crypto/text-cipher.ts`'s
 * `encryptText`/`decryptText` (AES-256-GCM, random 12-byte IV, base64
 * ciphertext/iv) using Node's built-in WebCrypto — there's no workspace
 * dependency edge from apps/server to apps/web, so this mirrors the wire
 * format by hand rather than importing it, matching the convention
 * already used in upload.test.ts/download.test.ts for file content.
 */
async function encryptNameFixture(
  plaintext: string,
  key: webcrypto.CryptoKey
): Promise<{ ciphertext: string; iv: string }> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertextBytes = new Uint8Array(
    await subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext)
    )
  );
  return {
    ciphertext: Buffer.from(ciphertextBytes).toString("base64"),
    iv: Buffer.from(iv).toString("base64")
  };
}

async function decryptNameFixture(
  payload: { ciphertext: string; iv: string },
  key: webcrypto.CryptoKey
): Promise<string> {
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const iv = Buffer.from(payload.iv, "base64");
  const plaintextBytes = await subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plaintextBytes);
}

function bearerTokenFor(ownerId: string): string {
  return signAccessToken({
    userId: ownerId,
    username: "tester",
    secret: TEST_ENV.JWT_SECRET,
    expiresIn: TEST_ENV.JWT_EXPIRES_IN
  });
}

describe("encrypted file/folder names never reach the server as plaintext", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vaultdrop-names-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("POST /files/upload-encrypted", () => {
    it("stores the file's name as authenticated ciphertext only — DB row and storage key carry no trace of the plaintext, and it decrypts back correctly with the real key", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma, files } = createFakePrisma([
        { id: vaultId, ownerId, name: "Test Vault" }
      ]);
      const storage = new LocalStorageAdapter(tmpDir);
      const app = createApp(prisma, TEST_ENV, storage);
      const token = bearerTokenFor(ownerId);

      const vaultDek = await subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );

      const marker = "TOP-SECRET-QUARTERLY-REPORT-2026.pdf";
      const nameCiphertext = await encryptNameFixture(marker, vaultDek);

      const params = new URLSearchParams({
        vaultId,
        encryptedName: nameCiphertext.ciphertext,
        nameIv: nameCiphertext.iv,
        mimeType: "application/pdf",
        encryptionVersion: "1",
        wrappedKeyCiphertext: Buffer.from("fake-wrapped-file-key").toString("base64"),
        wrappedKeyIv: Buffer.from("fake-iv-value").toString("base64")
      });

      const response = await request(app)
        .post(`/files/upload-encrypted?${params.toString()}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/octet-stream")
        .send(Buffer.from("irrelevant-content-ciphertext"));

      expect(response.status).toBe(201);

      // Nothing in the response body — the JSON the client actually
      // receives — contains the plaintext name anywhere.
      expect(JSON.stringify(response.body)).not.toContain(marker);
      expect(response.body.file.name).toBeNull();
      expect(response.body.file.encryptedName).toBe(nameCiphertext.ciphertext);

      // The raw DB row (what actually got persisted) matches: no plaintext
      // name column, and the ciphertext blob itself contains no trace of
      // the plaintext substring or a trivial reversible encoding of it.
      const row = files.find((f) => f.id === response.body.file.id);
      expect(row?.name).toBeNull();
      expect(row?.encryptedName).toBeTruthy();
      expect(row!.encryptedName!.includes(marker)).toBe(false);
      expect(Buffer.from(row!.encryptedName!, "base64").toString("utf8")).not.toBe(marker);

      // ...and it's genuinely authenticated AES-GCM ciphertext of the real
      // name — decrypting with the real (never-transmitted) vault DEK
      // recovers exactly the original plaintext.
      const decrypted = await decryptNameFixture(
        { ciphertext: row!.encryptedName!, iv: row!.nameIv! },
        vaultDek
      );
      expect(decrypted).toBe(marker);

      // The storage key (filesystem path / object key) must not embed the
      // plaintext name either — this used to leak it even though DB name
      // encryption alone wouldn't have caught that.
      expect(response.body.file.storageKey as string).not.toContain(marker);
      expect(response.body.file.storageKey as string).not.toContain("REPORT");
    });
  });

  describe("POST /folders", () => {
    it("stores an encrypted folder's name as authenticated ciphertext only", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma, folders } = createFakePrisma([
        { id: vaultId, ownerId, name: "Test Vault" }
      ]);
      const storage = new LocalStorageAdapter(tmpDir);
      const app = createApp(prisma, TEST_ENV, storage);
      const token = bearerTokenFor(ownerId);

      const vaultDek = await subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );

      const marker = "Divorce Proceedings 2026";
      const nameCiphertext = await encryptNameFixture(marker, vaultDek);

      const response = await request(app)
        .post("/folders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          vaultId,
          encryptedName: nameCiphertext.ciphertext,
          nameIv: nameCiphertext.iv
        });

      expect(response.status).toBe(201);
      expect(JSON.stringify(response.body)).not.toContain(marker);
      expect(response.body.folder.name).toBeNull();
      expect(response.body.folder.encrypted).toBe(true);

      const row = folders.find((f) => f.id === response.body.folder.id);
      expect(row?.name).toBeNull();
      expect(row!.encryptedName!.includes(marker)).toBe(false);

      const decrypted = await decryptNameFixture(
        { ciphertext: row!.encryptedName!, iv: row!.nameIv! },
        vaultDek
      );
      expect(decrypted).toBe(marker);
    });
  });

  describe("GET /files and GET /folders/contents", () => {
    it("never include a plaintext name anywhere in the response body for encrypted rows", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([
        { id: vaultId, ownerId, name: "Test Vault" }
      ]);
      const storage = new LocalStorageAdapter(tmpDir);
      const app = createApp(prisma, TEST_ENV, storage);
      const token = bearerTokenFor(ownerId);

      const vaultDek = await subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );

      const marker = "SEVERANCE-AGREEMENT-CONFIDENTIAL";
      const nameCiphertext = await encryptNameFixture(marker, vaultDek);

      const params = new URLSearchParams({
        vaultId,
        encryptedName: nameCiphertext.ciphertext,
        nameIv: nameCiphertext.iv,
        mimeType: "text/plain",
        encryptionVersion: "1",
        wrappedKeyCiphertext: Buffer.from("fake-wrapped-file-key").toString("base64"),
        wrappedKeyIv: Buffer.from("fake-iv-value").toString("base64")
      });

      await request(app)
        .post(`/files/upload-encrypted?${params.toString()}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/octet-stream")
        .send(Buffer.from("irrelevant"));

      const listResponse = await request(app)
        .get(`/files?vaultId=${vaultId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(listResponse.status).toBe(200);
      expect(JSON.stringify(listResponse.body)).not.toContain(marker);

      const contentsResponse = await request(app)
        .get(`/folders/contents?vaultId=${vaultId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(contentsResponse.status).toBe(200);
      expect(JSON.stringify(contentsResponse.body)).not.toContain(marker);
    });
  });

  describe("PATCH rename enforces the payload shape matches the row's encrypted flag", () => {
    it("rejects a plaintext-name rename of an encrypted file", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([
        { id: vaultId, ownerId, name: "Test Vault" }
      ]);
      const storage = new LocalStorageAdapter(tmpDir);
      const app = createApp(prisma, TEST_ENV, storage);
      const token = bearerTokenFor(ownerId);

      const vaultDek = await subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      const nameCiphertext = await encryptNameFixture("secret.txt", vaultDek);

      const params = new URLSearchParams({
        vaultId,
        encryptedName: nameCiphertext.ciphertext,
        nameIv: nameCiphertext.iv,
        mimeType: "text/plain",
        encryptionVersion: "1",
        wrappedKeyCiphertext: Buffer.from("fake-wrapped-file-key").toString("base64"),
        wrappedKeyIv: Buffer.from("fake-iv-value").toString("base64")
      });

      const uploadResponse = await request(app)
        .post(`/files/upload-encrypted?${params.toString()}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/octet-stream")
        .send(Buffer.from("irrelevant"));

      const fileId = uploadResponse.body.file.id as string;

      const renameResponse = await request(app)
        .patch(`/files/${fileId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "attempted-plaintext-rename.txt" });

      expect(renameResponse.status).toBe(400);
    });

    it("rejects a ciphertext rename of a legacy plaintext file", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([
        { id: vaultId, ownerId, name: "Test Vault" }
      ]);
      const storage = new LocalStorageAdapter(tmpDir);
      const app = createApp(prisma, TEST_ENV, storage);
      const token = bearerTokenFor(ownerId);

      const uploadResponse = await request(app)
        .post(`/files/upload?vaultId=${vaultId}`)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", Buffer.from("hello"), "hello.txt");

      const fileId = uploadResponse.body.file.id as string;

      const renameResponse = await request(app)
        .patch(`/files/${fileId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ encryptedName: "abc", nameIv: "def" });

      expect(renameResponse.status).toBe(400);
    });

    it("rejects a plaintext-name rename of an encrypted folder, and a ciphertext rename of a legacy folder", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([
        { id: vaultId, ownerId, name: "Test Vault" }
      ]);
      const storage = new LocalStorageAdapter(tmpDir);
      const app = createApp(prisma, TEST_ENV, storage);
      const token = bearerTokenFor(ownerId);

      const vaultDek = await subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      const nameCiphertext = await encryptNameFixture("Photos", vaultDek);

      const encryptedFolderResponse = await request(app)
        .post("/folders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          vaultId,
          encryptedName: nameCiphertext.ciphertext,
          nameIv: nameCiphertext.iv
        });

      const legacyFolderResponse = await request(app)
        .post("/folders")
        .set("Authorization", `Bearer ${token}`)
        .send({ vaultId, name: "Legacy Folder" });

      const encryptedRename = await request(app)
        .patch(`/folders/${encryptedFolderResponse.body.folder.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "attempted-plaintext-rename" });

      expect(encryptedRename.status).toBe(400);

      const legacyRename = await request(app)
        .patch(`/folders/${legacyFolderResponse.body.folder.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ encryptedName: "abc", nameIv: "def" });

      expect(legacyRename.status).toBe(400);
    });
  });

  describe("GET /folders/search", () => {
    it("never matches an encrypted vault's ciphertext against a plaintext query, while the same query does match an equivalent legacy vault", async () => {
      const ownerId = randomUUID();
      const encryptedVaultId = randomUUID();
      const legacyVaultId = randomUUID();
      const { prisma } = createFakePrisma([
        { id: encryptedVaultId, ownerId, name: "Encrypted Vault" },
        { id: legacyVaultId, ownerId, name: "Legacy Vault" }
      ]);
      const storage = new LocalStorageAdapter(tmpDir);
      const app = createApp(prisma, TEST_ENV, storage);
      const token = bearerTokenFor(ownerId);

      const vaultDek = await subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );

      const marker = "invoice-march-2026.pdf";
      const nameCiphertext = await encryptNameFixture(marker, vaultDek);

      const encryptedParams = new URLSearchParams({
        vaultId: encryptedVaultId,
        encryptedName: nameCiphertext.ciphertext,
        nameIv: nameCiphertext.iv,
        mimeType: "application/pdf",
        encryptionVersion: "1",
        wrappedKeyCiphertext: Buffer.from("fake-wrapped-file-key").toString("base64"),
        wrappedKeyIv: Buffer.from("fake-iv-value").toString("base64")
      });

      const encryptedUpload = await request(app)
        .post(`/files/upload-encrypted?${encryptedParams.toString()}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/octet-stream")
        .send(Buffer.from("irrelevant"));

      expect(encryptedUpload.status).toBe(201);

      await request(app)
        .post(`/files/upload?vaultId=${legacyVaultId}`)
        .set("Authorization", `Bearer ${token}`)
        .attach("file", Buffer.from("hello"), marker);

      // Baseline: the legacy vault's server-side substring search does
      // find the file — proving the query itself is a real match and the
      // encrypted-vault result below isn't just a broken/empty query.
      const legacySearch = await request(app)
        .get(`/folders/search?vaultId=${legacyVaultId}&query=invoice`)
        .set("Authorization", `Bearer ${token}`);

      expect(legacySearch.status).toBe(200);
      expect(legacySearch.body.files).toHaveLength(1);

      // The encrypted vault's row has the exact same name, but the server
      // cannot see it — the query must never match.
      const encryptedSearch = await request(app)
        .get(`/folders/search?vaultId=${encryptedVaultId}&query=invoice`)
        .set("Authorization", `Bearer ${token}`);

      expect(encryptedSearch.status).toBe(200);
      expect(encryptedSearch.body.files).toHaveLength(0);
      expect(JSON.stringify(encryptedSearch.body)).not.toContain(marker);
    });

    it("omitting `query` returns the unfiltered subtree (ciphertext fields, no plaintext) for client-side local search", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([
        { id: vaultId, ownerId, name: "Test Vault" }
      ]);
      const storage = new LocalStorageAdapter(tmpDir);
      const app = createApp(prisma, TEST_ENV, storage);
      const token = bearerTokenFor(ownerId);

      const vaultDek = await subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );

      const marker = "board-meeting-notes.docx";
      const nameCiphertext = await encryptNameFixture(marker, vaultDek);

      const params = new URLSearchParams({
        vaultId,
        encryptedName: nameCiphertext.ciphertext,
        nameIv: nameCiphertext.iv,
        mimeType: "application/octet-stream",
        encryptionVersion: "1",
        wrappedKeyCiphertext: Buffer.from("fake-wrapped-file-key").toString("base64"),
        wrappedKeyIv: Buffer.from("fake-iv-value").toString("base64")
      });

      const uploadResponse = await request(app)
        .post(`/files/upload-encrypted?${params.toString()}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/octet-stream")
        .send(Buffer.from("irrelevant"));

      const subtreeResponse = await request(app)
        .get(`/folders/search?vaultId=${vaultId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(subtreeResponse.status).toBe(200);
      expect(JSON.stringify(subtreeResponse.body)).not.toContain(marker);
      expect(subtreeResponse.body.files).toHaveLength(1);
      expect(subtreeResponse.body.files[0].id).toBe(uploadResponse.body.file.id);
      expect(subtreeResponse.body.files[0].encryptedName).toBe(nameCiphertext.ciphertext);
    });
  });
});
