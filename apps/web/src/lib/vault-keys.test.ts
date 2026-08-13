import { describe, expect, it } from "vitest";
import type { VaultDTO } from "@vaultdrop/types";
import { exportKeyRaw } from "@/lib/crypto";
import {
  createVaultEnvelope,
  hasEncryptionEnvelope,
  unwrapVaultDek
} from "./vault-keys.js";

function baseVault(overrides: Partial<VaultDTO> = {}): VaultDTO {
  return {
    id: "vault-1",
    name: "Test Vault",
    ownerId: "user-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    encryptionVersion: null,
    kekSalt: null,
    kekIterations: null,
    kekHash: null,
    wrappedDekCiphertext: null,
    wrappedDekIv: null,
    ...overrides
  };
}

async function encryptedVaultFixture(password: string) {
  const { dek, envelope } = await createVaultEnvelope(password);
  const vault = baseVault({
    encryptionVersion: envelope.encryptionVersion,
    kekSalt: envelope.kekSalt,
    kekIterations: envelope.kekIterations,
    kekHash: envelope.kekHash,
    wrappedDekCiphertext: envelope.wrappedDekCiphertext,
    wrappedDekIv: envelope.wrappedDekIv
  });
  return { dek, vault };
}

describe("hasEncryptionEnvelope", () => {
  it("is false for a legacy vault (every field null)", () => {
    expect(hasEncryptionEnvelope(baseVault())).toBe(false);
  });

  it("is false when only some envelope fields are set", () => {
    expect(
      hasEncryptionEnvelope(
        baseVault({ encryptionVersion: 1, kekSalt: "abc" })
      )
    ).toBe(false);
  });

  it("is true when every envelope field is set", async () => {
    const { vault } = await encryptedVaultFixture("hunter2");
    expect(hasEncryptionEnvelope(vault)).toBe(true);
  });
});

describe("createVaultEnvelope / unwrapVaultDek", () => {
  it("round-trips: unwrapping with the correct password recovers the same DEK bytes", async () => {
    const { dek, vault } = await encryptedVaultFixture("correct horse battery staple");

    const unwrapped = await unwrapVaultDek(vault, "correct horse battery staple");

    const originalRaw = await exportKeyRaw(dek);
    const unwrappedRaw = await exportKeyRaw(unwrapped);

    expect(Array.from(unwrappedRaw)).toEqual(Array.from(originalRaw));
  });

  it("rejects unlocking with the wrong password", async () => {
    const { vault } = await encryptedVaultFixture("correct horse battery staple");

    await expect(
      unwrapVaultDek(vault, "totally-wrong-password")
    ).rejects.toThrow();
  });

  it("throws for a legacy vault with no envelope, rather than deriving anything", async () => {
    await expect(
      unwrapVaultDek(baseVault(), "any-password")
    ).rejects.toThrow(/no encryption envelope/i);
  });

  it("throws for an unsupported KEK hash algorithm instead of silently proceeding", async () => {
    const { vault } = await encryptedVaultFixture("hunter2");
    const tampered = { ...vault, kekHash: "SHA-1" };

    await expect(unwrapVaultDek(tampered, "hunter2")).rejects.toThrow(
      /unsupported/i
    );
  });

  it("produces a DEK usable for wrap/unwrap of further key material", async () => {
    const { dek } = await encryptedVaultFixture("hunter2");
    expect(dek.usages.sort()).toEqual(
      ["decrypt", "encrypt", "unwrapKey", "wrapKey"].sort()
    );
  });
});
