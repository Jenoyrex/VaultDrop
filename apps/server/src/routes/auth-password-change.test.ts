import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { ServerEnv } from "@vaultdrop/config";
import { hashPassword, signAccessToken } from "@vaultdrop/crypto";
import { createApp } from "../app.js";
import { LocalStorageAdapter } from "../storage/local-storage-adapter.js";
import { createFakePrisma, type FakeUserRow } from "../test-support/fake-prisma.js";

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

const CURRENT_PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "a-brand-new-password-123";

async function seedUser(username = "tester"): Promise<FakeUserRow> {
  const now = new Date();
  return {
    id: randomUUID(),
    username,
    passwordHash: await hashPassword(CURRENT_PASSWORD),
    createdAt: now,
    updatedAt: now
  };
}

function bearerTokenFor(userId: string, username: string): string {
  return signAccessToken({
    userId,
    username,
    secret: TEST_ENV.JWT_SECRET,
    expiresIn: TEST_ENV.JWT_EXPIRES_IN
  });
}

/** An encrypted vault seed, distinguishable by `suffix` across fixtures. */
function encryptedVaultSeed(id: string, ownerId: string, suffix: string) {
  return {
    id,
    ownerId,
    name: `Vault ${suffix}`,
    encryptionVersion: 1,
    kekSalt: `old-kek-salt-${suffix}`,
    kekIterations: 600_000,
    kekHash: "SHA-256",
    wrappedDekCiphertext: `old-wrapped-dek-ciphertext-${suffix}`,
    wrappedDekIv: `old-wrapped-dek-iv-${suffix}`
  };
}

function rewrapEntryFor(vaultId: string, suffix: string) {
  return {
    vaultId,
    encryptionVersion: 1,
    kekSalt: `new-kek-salt-${suffix}`,
    kekIterations: 600_000,
    kekHash: "SHA-256",
    wrappedDekCiphertext: `new-wrapped-dek-ciphertext-${suffix}`,
    wrappedDekIv: `new-wrapped-dek-iv-${suffix}`
  };
}

describe("PUT /auth/password", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vaultdrop-password-change-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("requires authentication", async () => {
    const { prisma } = createFakePrisma();
    const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));

    const res = await request(app)
      .put("/auth/password")
      .send({ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD, vaults: [] });

    expect(res.status).toBe(401);
    // Missing bearer token -> INVALID_TOKEN, the signal that triggers a
    // global client-side session-expired flow.
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });

  it("succeeds when every encrypted vault is included: passwordHash and every vault's envelope update together", async () => {
    const user = await seedUser();
    const v1 = encryptedVaultSeed(randomUUID(), user.id, "1");
    const v2 = encryptedVaultSeed(randomUUID(), user.id, "2");
    const { prisma, vaults } = createFakePrisma([v1, v2], [user]);
    const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
    const token = bearerTokenFor(user.id, user.username);

    const res = await request(app)
      .put("/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
        vaults: [rewrapEntryFor(v1.id, "1"), rewrapEntryFor(v2.id, "2")]
      });

    expect(res.status).toBe(204);

    // The password genuinely changed, end-to-end.
    const oldLogin = await request(app)
      .post("/auth/login")
      .send({ username: user.username, password: CURRENT_PASSWORD });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post("/auth/login")
      .send({ username: user.username, password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);

    const row1 = vaults.find((v) => v.id === v1.id);
    const row2 = vaults.find((v) => v.id === v2.id);
    expect(row1?.wrappedDekCiphertext).toBe("new-wrapped-dek-ciphertext-1");
    expect(row2?.wrappedDekCiphertext).toBe("new-wrapped-dek-ciphertext-2");
  });

  it("rejects with 401 and changes nothing when the current password is wrong", async () => {
    const user = await seedUser();
    const v1 = encryptedVaultSeed(randomUUID(), user.id, "1");
    const { prisma, vaults, users } = createFakePrisma([v1], [user]);
    const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
    const token = bearerTokenFor(user.id, user.username);
    const passwordHashBefore = users[0]?.passwordHash;

    const res = await request(app)
      .put("/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({
        currentPassword: "definitely-the-wrong-password",
        newPassword: NEW_PASSWORD,
        vaults: [rewrapEntryFor(v1.id, "1")]
      });

    expect(res.status).toBe(401);
    // A valid bearer token was supplied — this is a credential-check
    // failure (wrong current password), not an invalid-token condition,
    // so it must keep the generic code and never trigger a global
    // session-expiry on the client.
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(users[0]?.passwordHash).toBe(passwordHashBefore);
    expect(vaults.find((v) => v.id === v1.id)?.wrappedDekCiphertext).toBe(
      "old-wrapped-dek-ciphertext-1"
    );
  });

  it("rejects a submission missing an encrypted vault: 409, nothing changes", async () => {
    const user = await seedUser();
    const v1 = encryptedVaultSeed(randomUUID(), user.id, "1");
    const v2 = encryptedVaultSeed(randomUUID(), user.id, "2");
    const { prisma, vaults, users } = createFakePrisma([v1, v2], [user]);
    const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
    const token = bearerTokenFor(user.id, user.username);
    const passwordHashBefore = users[0]?.passwordHash;

    const res = await request(app)
      .put("/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
        // v2 is deliberately omitted.
        vaults: [rewrapEntryFor(v1.id, "1")]
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("VAULT_SET_MISMATCH");
    expect(users[0]?.passwordHash).toBe(passwordHashBefore);
    expect(vaults.find((v) => v.id === v1.id)?.wrappedDekCiphertext).toBe(
      "old-wrapped-dek-ciphertext-1"
    );
    expect(vaults.find((v) => v.id === v2.id)?.wrappedDekCiphertext).toBe(
      "old-wrapped-dek-ciphertext-2"
    );
  });

  it("rejects an extra/unknown vault ID: 409, nothing changes", async () => {
    const user = await seedUser();
    const v1 = encryptedVaultSeed(randomUUID(), user.id, "1");
    const { prisma, vaults, users } = createFakePrisma([v1], [user]);
    const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
    const token = bearerTokenFor(user.id, user.username);
    const passwordHashBefore = users[0]?.passwordHash;

    const res = await request(app)
      .put("/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
        vaults: [rewrapEntryFor(v1.id, "1"), rewrapEntryFor(randomUUID(), "nonexistent")]
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("VAULT_SET_MISMATCH");
    expect(users[0]?.passwordHash).toBe(passwordHashBefore);
    expect(vaults.find((v) => v.id === v1.id)?.wrappedDekCiphertext).toBe(
      "old-wrapped-dek-ciphertext-1"
    );
  });

  it("rejects a duplicate vault ID: 400, nothing changes", async () => {
    const user = await seedUser();
    const v1 = encryptedVaultSeed(randomUUID(), user.id, "1");
    const { prisma, vaults, users } = createFakePrisma([v1], [user]);
    const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
    const token = bearerTokenFor(user.id, user.username);
    const passwordHashBefore = users[0]?.passwordHash;

    const res = await request(app)
      .put("/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
        vaults: [rewrapEntryFor(v1.id, "1"), rewrapEntryFor(v1.id, "1-again")]
      });

    expect(res.status).toBe(400);
    expect(users[0]?.passwordHash).toBe(passwordHashBefore);
    expect(vaults.find((v) => v.id === v1.id)?.wrappedDekCiphertext).toBe(
      "old-wrapped-dek-ciphertext-1"
    );
  });

  it("rejects a vault ID belonging to another user: 409, nothing changes for either account", async () => {
    const userA = await seedUser("user-a");
    const userB = await seedUser("user-b");
    const vaultA = encryptedVaultSeed(randomUUID(), userA.id, "a");
    const vaultB = encryptedVaultSeed(randomUUID(), userB.id, "b");
    const { prisma, vaults, users } = createFakePrisma([vaultA, vaultB], [userA, userB]);
    const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
    const tokenA = bearerTokenFor(userA.id, userA.username);
    const hashABefore = users.find((u) => u.id === userA.id)?.passwordHash;
    const hashBBefore = users.find((u) => u.id === userB.id)?.passwordHash;

    const res = await request(app)
      .put("/auth/password")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
        // Includes user A's own vault plus user B's — B's should never be
        // migratable by A, regardless of what A submits for it.
        vaults: [rewrapEntryFor(vaultA.id, "a"), rewrapEntryFor(vaultB.id, "b")]
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("VAULT_SET_MISMATCH");
    expect(users.find((u) => u.id === userA.id)?.passwordHash).toBe(hashABefore);
    expect(users.find((u) => u.id === userB.id)?.passwordHash).toBe(hashBBefore);
    expect(vaults.find((v) => v.id === vaultA.id)?.wrappedDekCiphertext).toBe(
      "old-wrapped-dek-ciphertext-a"
    );
    expect(vaults.find((v) => v.id === vaultB.id)?.wrappedDekCiphertext).toBe(
      "old-wrapped-dek-ciphertext-b"
    );
  });

  it("legacy plaintext vaults don't block password change and are never required in the submission", async () => {
    const user = await seedUser();
    const legacyVault = { id: randomUUID(), ownerId: user.id, name: "Legacy Vault" };
    const encryptedVault = encryptedVaultSeed(randomUUID(), user.id, "1");
    const { prisma, vaults } = createFakePrisma([legacyVault, encryptedVault], [user]);
    const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
    const token = bearerTokenFor(user.id, user.username);
    const legacyBefore = { ...vaults.find((v) => v.id === legacyVault.id) };

    const res = await request(app)
      .put("/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
        // Only the encrypted vault is submitted — the legacy vault is
        // correctly excluded, not omitted-by-mistake.
        vaults: [rewrapEntryFor(encryptedVault.id, "1")]
      });

    expect(res.status).toBe(204);
    expect(vaults.find((v) => v.id === legacyVault.id)).toEqual(legacyBefore);
    expect(vaults.find((v) => v.id === encryptedVault.id)?.wrappedDekCiphertext).toBe(
      "new-wrapped-dek-ciphertext-1"
    );
  });

  it("rolls back everything — including an already-applied update — on a mid-transaction failure", async () => {
    const user = await seedUser();
    const v1 = encryptedVaultSeed(randomUUID(), user.id, "1");
    const v2 = encryptedVaultSeed(randomUUID(), user.id, "2");
    const v3 = encryptedVaultSeed(randomUUID(), user.id, "3");
    const { prisma, vaults, users, forceVaultUpdateFailureFor } = createFakePrisma(
      [v1, v2, v3],
      [user]
    );
    const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
    const token = bearerTokenFor(user.id, user.username);
    const passwordHashBefore = users[0]?.passwordHash;

    // v2's update is forced to fail — v1 (updated first, in submission
    // order) will have already been applied in-memory by the time this
    // throws, which is exactly what proves rollback undoes apparent
    // successes-so-far, not just the operation that failed.
    forceVaultUpdateFailureFor(v2.id);

    const res = await request(app)
      .put("/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
        vaults: [rewrapEntryFor(v1.id, "1"), rewrapEntryFor(v2.id, "2"), rewrapEntryFor(v3.id, "3")]
      });

    expect(res.status).toBe(500);
    expect(users[0]?.passwordHash).toBe(passwordHashBefore);
    expect(vaults.find((v) => v.id === v1.id)?.wrappedDekCiphertext).toBe(
      "old-wrapped-dek-ciphertext-1"
    );
    expect(vaults.find((v) => v.id === v2.id)?.wrappedDekCiphertext).toBe(
      "old-wrapped-dek-ciphertext-2"
    );
    expect(vaults.find((v) => v.id === v3.id)?.wrappedDekCiphertext).toBe(
      "old-wrapped-dek-ciphertext-3"
    );
  });

  it("leaves the recovery envelope untouched by a successful password change", async () => {
    const user = await seedUser();
    const v1 = {
      ...encryptedVaultSeed(randomUUID(), user.id, "1"),
      recoveryWrappedDekCiphertext: "recovery-ciphertext",
      recoveryWrappedDekIv: "recovery-iv"
    };
    const { prisma, vaults } = createFakePrisma([v1], [user]);
    const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
    const token = bearerTokenFor(user.id, user.username);

    const res = await request(app)
      .put("/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
        vaults: [rewrapEntryFor(v1.id, "1")]
      });

    expect(res.status).toBe(204);
    const row = vaults.find((v) => v.id === v1.id);
    expect(row?.recoveryWrappedDekCiphertext).toBe("recovery-ciphertext");
    expect(row?.recoveryWrappedDekIv).toBe("recovery-iv");
  });

  it("never queries or modifies file/folder rows", async () => {
    const user = await seedUser();
    const v1 = encryptedVaultSeed(randomUUID(), user.id, "1");
    const { prisma, files, folders } = createFakePrisma([v1], [user]);
    folders.push({
      id: randomUUID(),
      name: "A Folder",
      vaultId: v1.id,
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      encrypted: false,
      encryptedName: null,
      nameIv: null
    });
    files.push({
      id: randomUUID(),
      name: "a-file.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      vaultId: v1.id,
      folderId: null,
      storageProvider: "LOCAL",
      storageKey: `${v1.id}/a-file.txt`,
      createdAt: new Date(),
      updatedAt: new Date(),
      encrypted: false,
      wrappedKeyCiphertext: null,
      wrappedKeyIv: null,
      encryptedName: null,
      nameIv: null
    });
    const filesBefore = files.map((f) => ({ ...f }));
    const foldersBefore = folders.map((f) => ({ ...f }));

    const app = createApp(prisma, TEST_ENV, new LocalStorageAdapter(tmpDir));
    const token = bearerTokenFor(user.id, user.username);

    const res = await request(app)
      .put("/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
        vaults: [rewrapEntryFor(v1.id, "1")]
      });

    expect(res.status).toBe(204);
    expect(files).toEqual(filesBefore);
    expect(folders).toEqual(foldersBefore);
  });
});
