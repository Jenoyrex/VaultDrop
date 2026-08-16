import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import type { ServerEnv } from "@vaultdrop/config";
import type { StorageAdapter } from "@vaultdrop/types";
import { signAccessToken } from "@vaultdrop/crypto";
import { createApp } from "../app.js";
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

// Vault routes never touch storage — every method throws if called, so any
// accidental storage access fails the test loudly instead of silently
// succeeding against a real filesystem.
const unusedStorage: StorageAdapter = {
  put: () => {
    throw new Error("not used by vault routes");
  },
  putStream: () => {
    throw new Error("not used by vault routes");
  },
  get: () => {
    throw new Error("not used by vault routes");
  },
  getStream: () => {
    throw new Error("not used by vault routes");
  },
  delete: () => {
    throw new Error("not used by vault routes");
  },
  exists: () => {
    throw new Error("not used by vault routes");
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

describe("POST /vaults", () => {
  it("creates a legacy (unencrypted) vault owned by the authenticated user", async () => {
    const ownerId = randomUUID();
    const { prisma, vaults } = createFakePrisma();
    const app = createApp(prisma, TEST_ENV, unusedStorage);
    const token = bearerTokenFor(ownerId);

    const res = await request(app)
      .post("/vaults")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "My Vault" });

    expect(res.status).toBe(201);
    expect(res.body.vault.name).toBe("My Vault");
    expect(res.body.vault.ownerId).toBe(ownerId);

    // Asserts against the fake Prisma store's own row, not just the HTTP
    // response — proving the request actually went through
    // createVaultRouter -> VaultService.createVault -> prisma.vault.create,
    // not merely that the route returned a plausible-looking body.
    expect(vaults).toHaveLength(1);
    expect(vaults[0]).toMatchObject({
      id: res.body.vault.id,
      ownerId,
      name: "My Vault",
      wrappedDekCiphertext: null
    });
  });

  it("creates an encrypted vault, persisting the full encryption envelope", async () => {
    const ownerId = randomUUID();
    const { prisma, vaults } = createFakePrisma();
    const app = createApp(prisma, TEST_ENV, unusedStorage);
    const token = bearerTokenFor(ownerId);

    const res = await request(app)
      .post("/vaults")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Encrypted Vault",
        encryption: {
          encryptionVersion: 1,
          kekSalt: "kek-salt",
          kekIterations: 600_000,
          kekHash: "SHA-256",
          wrappedDekCiphertext: "wrapped-dek-ciphertext",
          wrappedDekIv: "wrapped-dek-iv"
        }
      });

    expect(res.status).toBe(201);
    expect(res.body.vault.ownerId).toBe(ownerId);

    expect(vaults).toHaveLength(1);
    expect(vaults[0]).toMatchObject({
      ownerId,
      name: "Encrypted Vault",
      encryptionVersion: 1,
      kekSalt: "kek-salt",
      kekIterations: 600_000,
      kekHash: "SHA-256",
      wrappedDekCiphertext: "wrapped-dek-ciphertext",
      wrappedDekIv: "wrapped-dek-iv"
    });
  });

  it("rejects an unauthenticated request and creates nothing", async () => {
    const { prisma, vaults } = createFakePrisma();
    const app = createApp(prisma, TEST_ENV, unusedStorage);

    const res = await request(app).post("/vaults").send({ name: "Should Not Exist" });

    expect(res.status).toBe(401);
    expect(vaults).toHaveLength(0);
  });
});
