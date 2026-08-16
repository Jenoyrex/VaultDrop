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

/** An already-encrypted (password-wrapped) vault, with no recovery envelope yet. */
function encryptedVaultSeed(id: string, ownerId: string) {
  return {
    id,
    ownerId,
    name: "Test Vault",
    encryptionVersion: 1,
    kekSalt: "seed-kek-salt",
    kekIterations: 600_000,
    kekHash: "SHA-256",
    wrappedDekCiphertext: "seed-wrapped-dek-ciphertext",
    wrappedDekIv: "seed-wrapped-dek-iv"
  };
}

describe("vault recovery routes", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vaultdrop-recovery-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("PUT /vaults/:vaultId/recovery-key", () => {
    it("stores exactly the ciphertext/IV it was given, and never echoes recovery material back", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma, vaults } = createFakePrisma([encryptedVaultSeed(vaultId, ownerId)]);
      const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
      const token = bearerTokenFor(ownerId);

      const res = await request(app)
        .put(`/vaults/${vaultId}/recovery-key`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          recoveryWrappedDekCiphertext: "recovery-ciphertext-1",
          recoveryWrappedDekIv: "recovery-iv-1"
        });

      expect(res.status).toBe(200);
      expect(res.body.vault.hasRecoveryKey).toBe(true);
      expect(res.body.vault).not.toHaveProperty("recoveryWrappedDekCiphertext");
      expect(res.body.vault).not.toHaveProperty("recoveryWrappedDekIv");

      const row = vaults.find((v) => v.id === vaultId);
      expect(row?.recoveryWrappedDekCiphertext).toBe("recovery-ciphertext-1");
      expect(row?.recoveryWrappedDekIv).toBe("recovery-iv-1");
      // Enrolling recovery must never touch the password-wrap columns.
      expect(row?.wrappedDekCiphertext).toBe("seed-wrapped-dek-ciphertext");
    });

    it("replaces (and thereby invalidates) a previous recovery envelope outright", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const seed = {
        ...encryptedVaultSeed(vaultId, ownerId),
        recoveryWrappedDekCiphertext: "old-recovery-ciphertext",
        recoveryWrappedDekIv: "old-recovery-iv"
      };
      const { prisma, vaults } = createFakePrisma([seed]);
      const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
      const token = bearerTokenFor(ownerId);

      await request(app)
        .put(`/vaults/${vaultId}/recovery-key`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          recoveryWrappedDekCiphertext: "new-recovery-ciphertext",
          recoveryWrappedDekIv: "new-recovery-iv"
        })
        .expect(200);

      const row = vaults.find((v) => v.id === vaultId);
      expect(row?.recoveryWrappedDekCiphertext).toBe("new-recovery-ciphertext");
      expect(row?.recoveryWrappedDekIv).toBe("new-recovery-iv");
      // The old ciphertext is gone entirely, not archived anywhere.
      expect(JSON.stringify(row)).not.toContain("old-recovery-ciphertext");
    });

    it("rejects enrolling recovery on a vault with no encryption envelope (legacy plaintext vault)", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([{ id: vaultId, ownerId, name: "Legacy Vault" }]);
      const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
      const token = bearerTokenFor(ownerId);

      const res = await request(app)
        .put(`/vaults/${vaultId}/recovery-key`)
        .set("Authorization", `Bearer ${token}`)
        .send({ recoveryWrappedDekCiphertext: "x", recoveryWrappedDekIv: "y" });

      expect(res.status).toBe(400);
    });

    it("rejects enrollment from a user who does not own the vault", async () => {
      const ownerId = randomUUID();
      const otherUserId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([encryptedVaultSeed(vaultId, ownerId)]);
      const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
      const token = bearerTokenFor(otherUserId);

      const res = await request(app)
        .put(`/vaults/${vaultId}/recovery-key`)
        .set("Authorization", `Bearer ${token}`)
        .send({ recoveryWrappedDekCiphertext: "x", recoveryWrappedDekIv: "y" });

      expect(res.status).toBe(403);
    });
  });

  describe("GET /vaults/:vaultId/recovery-key", () => {
    it("returns 404 RECOVERY_NOT_CONFIGURED when no recovery envelope exists", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([encryptedVaultSeed(vaultId, ownerId)]);
      const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
      const token = bearerTokenFor(ownerId);

      const res = await request(app)
        .get(`/vaults/${vaultId}/recovery-key`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("RECOVERY_NOT_CONFIGURED");
    });

    it("returns the recovery envelope only to the owning user, once configured", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const seed = {
        ...encryptedVaultSeed(vaultId, ownerId),
        recoveryWrappedDekCiphertext: "recovery-ciphertext",
        recoveryWrappedDekIv: "recovery-iv"
      };
      const { prisma } = createFakePrisma([seed]);
      const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
      const ownerToken = bearerTokenFor(ownerId);
      const strangerToken = bearerTokenFor(randomUUID());

      const ownerRes = await request(app)
        .get(`/vaults/${vaultId}/recovery-key`)
        .set("Authorization", `Bearer ${ownerToken}`);

      expect(ownerRes.status).toBe(200);
      expect(ownerRes.body).toEqual({
        recoveryWrappedDekCiphertext: "recovery-ciphertext",
        recoveryWrappedDekIv: "recovery-iv"
      });

      const strangerRes = await request(app)
        .get(`/vaults/${vaultId}/recovery-key`)
        .set("Authorization", `Bearer ${strangerToken}`);

      expect(strangerRes.status).toBe(403);
    });

    it("never appears on the general GET /vaults/:vaultId response, even once configured", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const seed = {
        ...encryptedVaultSeed(vaultId, ownerId),
        recoveryWrappedDekCiphertext: "recovery-ciphertext",
        recoveryWrappedDekIv: "recovery-iv"
      };
      const { prisma } = createFakePrisma([seed]);
      const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
      const token = bearerTokenFor(ownerId);

      const res = await request(app)
        .get(`/vaults/${vaultId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.vault.hasRecoveryKey).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain("recovery-ciphertext");
      expect(JSON.stringify(res.body)).not.toContain("recovery-iv");
    });
  });

  describe("PUT /vaults/:vaultId/encryption", () => {
    it("re-wraps the password envelope without touching the recovery envelope", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const seed = {
        ...encryptedVaultSeed(vaultId, ownerId),
        recoveryWrappedDekCiphertext: "recovery-ciphertext",
        recoveryWrappedDekIv: "recovery-iv"
      };
      const { prisma, vaults } = createFakePrisma([seed]);
      const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
      const token = bearerTokenFor(ownerId);

      const res = await request(app)
        .put(`/vaults/${vaultId}/encryption`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          encryptionVersion: 1,
          kekSalt: "new-kek-salt",
          kekIterations: 600_000,
          kekHash: "SHA-256",
          wrappedDekCiphertext: "new-wrapped-dek-ciphertext",
          wrappedDekIv: "new-wrapped-dek-iv"
        });

      expect(res.status).toBe(200);

      const row = vaults.find((v) => v.id === vaultId);
      expect(row?.wrappedDekCiphertext).toBe("new-wrapped-dek-ciphertext");
      expect(row?.kekSalt).toBe("new-kek-salt");
      // Recovery columns are untouched by a password re-wrap.
      expect(row?.recoveryWrappedDekCiphertext).toBe("recovery-ciphertext");
      expect(row?.recoveryWrappedDekIv).toBe("recovery-iv");
    });

    it("rejects re-wrapping a vault with no existing encryption envelope", async () => {
      const ownerId = randomUUID();
      const vaultId = randomUUID();
      const { prisma } = createFakePrisma([{ id: vaultId, ownerId, name: "Legacy Vault" }]);
      const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
      const token = bearerTokenFor(ownerId);

      const res = await request(app)
        .put(`/vaults/${vaultId}/encryption`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          encryptionVersion: 1,
          kekSalt: "s",
          kekIterations: 600_000,
          kekHash: "SHA-256",
          wrappedDekCiphertext: "c",
          wrappedDekIv: "i"
        });

      expect(res.status).toBe(400);
    });
  });
});
