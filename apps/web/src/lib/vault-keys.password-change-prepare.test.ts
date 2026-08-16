import { describe, expect, it } from "vitest";
import type { VaultDTO } from "@vaultdrop/types";
import { exportKeyRaw } from "@/lib/crypto";
import {
  CorruptedVaultError,
  IncorrectPasswordError,
  createVaultEnvelope,
  prepareVaultRewrapsForPasswordChange,
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
    hasRecoveryKey: false,
    ...overrides
  };
}

async function encryptedVaultFixture(id: string, name: string, password: string) {
  const { dek, envelope } = await createVaultEnvelope(password);
  const vault = baseVault({
    id,
    name,
    encryptionVersion: envelope.encryptionVersion,
    kekSalt: envelope.kekSalt,
    kekIterations: envelope.kekIterations,
    kekHash: envelope.kekHash,
    wrappedDekCiphertext: envelope.wrappedDekCiphertext,
    wrappedDekIv: envelope.wrappedDekIv
  });
  return { dek, vault };
}

describe("prepareVaultRewrapsForPasswordChange", () => {
  it("returns an empty array immediately when there are no encrypted vaults", async () => {
    const rewraps = await prepareVaultRewrapsForPasswordChange([], "old-pw", "new-pw");
    expect(rewraps).toEqual([]);
  });

  it("preserves the DEK's exact bytes across the rewrap — proves files are never re-encrypted", async () => {
    const { dek, vault } = await encryptedVaultFixture("v1", "Vault One", "old-password");

    const [rewrap] = await prepareVaultRewrapsForPasswordChange(
      [vault],
      "old-password",
      "new-password"
    );

    const rewrappedVault = baseVault({
      id: vault.id,
      name: vault.name,
      encryptionVersion: rewrap!.encryptionVersion,
      kekSalt: rewrap!.kekSalt,
      kekIterations: rewrap!.kekIterations,
      kekHash: rewrap!.kekHash,
      wrappedDekCiphertext: rewrap!.wrappedDekCiphertext,
      wrappedDekIv: rewrap!.wrappedDekIv
    });

    const dekAfterRewrap = await unwrapVaultDek(rewrappedVault, "new-password");

    const originalRaw = await exportKeyRaw(dek);
    const afterRaw = await exportKeyRaw(dekAfterRewrap);

    expect(Array.from(afterRaw)).toEqual(Array.from(originalRaw));
  });

  it("produces one correctly-tagged rewrap entry per vault, for multiple vaults", async () => {
    const { vault: v1 } = await encryptedVaultFixture("v1", "Vault One", "old-password");
    const { vault: v2 } = await encryptedVaultFixture("v2", "Vault Two", "old-password");

    const rewraps = await prepareVaultRewrapsForPasswordChange(
      [v1, v2],
      "old-password",
      "new-password"
    );

    expect(rewraps.map((r) => r.vaultId).sort()).toEqual(["v1", "v2"]);
  });

  it("throws IncorrectPasswordError when every vault fails to unwrap (wrong current password)", async () => {
    const { vault: v1 } = await encryptedVaultFixture("v1", "Vault One", "old-password");
    const { vault: v2 } = await encryptedVaultFixture("v2", "Vault Two", "old-password");

    await expect(
      prepareVaultRewrapsForPasswordChange([v1, v2], "totally-wrong", "new-password")
    ).rejects.toThrow(IncorrectPasswordError);
  });

  it("throws CorruptedVaultError naming the specific vault when only some fail", async () => {
    const { vault: healthy } = await encryptedVaultFixture("v1", "Healthy Vault", "old-password");
    const { vault: corrupted } = await encryptedVaultFixture(
      "v2",
      "Broken Vault",
      "old-password"
    );
    // Simulate a corrupted envelope: the ciphertext no longer matches
    // what "old-password" actually wrapped, even though the vault was
    // originally created with that same account password.
    const tamperedCorrupted = { ...corrupted, wrappedDekCiphertext: "tampered-ciphertext" };

    let thrown: unknown;
    try {
      await prepareVaultRewrapsForPasswordChange(
        [healthy, tamperedCorrupted],
        "old-password",
        "new-password"
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(CorruptedVaultError);
    expect((thrown as InstanceType<typeof CorruptedVaultError>).vaultId).toBe("v2");
    expect((thrown as InstanceType<typeof CorruptedVaultError>).vaultName).toBe("Broken Vault");
  });

  it("never returns a partial result when a corrupted vault is present", async () => {
    const { vault: healthy } = await encryptedVaultFixture("v1", "Healthy Vault", "old-password");
    const { vault: corrupted } = await encryptedVaultFixture(
      "v2",
      "Broken Vault",
      "old-password"
    );
    const tamperedCorrupted = { ...corrupted, wrappedDekCiphertext: "tampered-ciphertext" };

    await expect(
      prepareVaultRewrapsForPasswordChange(
        [healthy, tamperedCorrupted],
        "old-password",
        "new-password"
      )
    ).rejects.toThrow(CorruptedVaultError);
    // The rejection itself (rather than any returned value) is the only
    // outcome — there is no code path that returns an array containing
    // just the healthy vault's rewrap.
  });
});
