import { describe, expect, it } from "vitest";
import { exportKeyRaw, generateAesKey } from "@/lib/crypto";
import { createRecoveryEnvelope, unwrapVaultDekWithRecoveryKey } from "./vault-keys.js";

describe("createRecoveryEnvelope / unwrapVaultDekWithRecoveryKey", () => {
  it("round-trips: unwrapping with the correct recovery key recovers the same DEK bytes", async () => {
    const dek = await generateAesKey();
    const { recoveryKey, envelope } = await createRecoveryEnvelope(dek);

    const unwrapped = await unwrapVaultDekWithRecoveryKey(envelope, recoveryKey);

    const originalRaw = await exportKeyRaw(dek);
    const unwrappedRaw = await exportKeyRaw(unwrapped);
    expect(Array.from(unwrappedRaw)).toEqual(Array.from(originalRaw));
  });

  it("rejects unlocking with the wrong recovery key", async () => {
    const dek = await generateAesKey();
    const { envelope } = await createRecoveryEnvelope(dek);
    const { recoveryKey: unrelatedKey } = await createRecoveryEnvelope(await generateAesKey());

    await expect(
      unwrapVaultDekWithRecoveryKey(envelope, unrelatedKey)
    ).rejects.toThrow();
  });

  it("rejects a malformed recovery key before ever touching WebCrypto", async () => {
    const dek = await generateAesKey();
    const { envelope } = await createRecoveryEnvelope(dek);

    await expect(
      unwrapVaultDekWithRecoveryKey(envelope, "not-a-real-recovery-key")
    ).rejects.toThrow(/format not recognized/i);
  });

  it("produces a different ciphertext/key every time, even for the same DEK", async () => {
    const dek = await generateAesKey();
    const first = await createRecoveryEnvelope(dek);
    const second = await createRecoveryEnvelope(dek);

    expect(first.recoveryKey).not.toBe(second.recoveryKey);
    expect(first.envelope.recoveryWrappedDekCiphertext).not.toBe(
      second.envelope.recoveryWrappedDekCiphertext
    );

    // Regenerating must invalidate the old key: the *old* recovery key
    // must not unwrap the *new* envelope.
    await expect(
      unwrapVaultDekWithRecoveryKey(second.envelope, first.recoveryKey)
    ).rejects.toThrow();
  });

  it("produces a DEK usable for wrap/unwrap of further key material", async () => {
    const dek = await generateAesKey();
    const { recoveryKey, envelope } = await createRecoveryEnvelope(dek);
    const unwrapped = await unwrapVaultDekWithRecoveryKey(envelope, recoveryKey);

    expect(unwrapped.usages.sort()).toEqual(
      ["decrypt", "encrypt", "unwrapKey", "wrapKey"].sort()
    );
  });
});
