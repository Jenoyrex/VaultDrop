import { describe, expect, it } from "vitest";
import { generateAesKey, encryptText } from "@/lib/crypto";
import { resolveDisplayName, NameDecryptionError } from "./resolve-name.js";

describe("resolveDisplayName", () => {
  it("returns a legacy (non-encrypted) entity's plaintext name unchanged, regardless of vaultDek", async () => {
    const entity = {
      encrypted: false,
      name: "quarterly-report-final.pdf",
      encryptedName: null,
      nameIv: null
    };

    expect(await resolveDisplayName(entity, undefined)).toBe(
      "quarterly-report-final.pdf"
    );

    const unrelatedKey = await generateAesKey();
    expect(await resolveDisplayName(entity, unrelatedKey)).toBe(
      "quarterly-report-final.pdf"
    );
  });

  it("throws NameDecryptionError for a legacy entity with no plaintext name (an invariant violation), never returning null/blank", async () => {
    const entity = {
      encrypted: false,
      name: null,
      encryptedName: null,
      nameIv: null
    };

    await expect(resolveDisplayName(entity, undefined)).rejects.toThrow(
      NameDecryptionError
    );
  });

  it("decrypts an encrypted entity's name with the correct vault DEK, round-tripping the original plaintext", async () => {
    const vaultDek = await generateAesKey();
    const payload = await encryptText("vacation photos 🏖️.zip", vaultDek);

    const entity = {
      encrypted: true,
      name: null,
      encryptedName: payload.ciphertext,
      nameIv: payload.iv
    };

    expect(await resolveDisplayName(entity, vaultDek)).toBe(
      "vacation photos 🏖️.zip"
    );
  });

  it("throws NameDecryptionError (never ciphertext, never a blank string) when the vault is locked (no vaultDek)", async () => {
    const vaultDek = await generateAesKey();
    const payload = await encryptText("secret-plan.docx", vaultDek);

    const entity = {
      encrypted: true,
      name: null,
      encryptedName: payload.ciphertext,
      nameIv: payload.iv
    };

    const error = await resolveDisplayName(entity, undefined).catch((e) => e);
    expect(error).toBeInstanceOf(NameDecryptionError);
    // Never leaks the ciphertext blob back out as if it were a name.
    expect(String(error)).not.toContain(payload.ciphertext);
  });

  it("throws NameDecryptionError when decrypting with the wrong vault DEK", async () => {
    const rightKey = await generateAesKey();
    const wrongKey = await generateAesKey();
    const payload = await encryptText("secret-plan.docx", rightKey);

    const entity = {
      encrypted: true,
      name: null,
      encryptedName: payload.ciphertext,
      nameIv: payload.iv
    };

    await expect(resolveDisplayName(entity, wrongKey)).rejects.toThrow(
      NameDecryptionError
    );
  });

  it("throws NameDecryptionError when the ciphertext has been tampered with", async () => {
    const vaultDek = await generateAesKey();
    const payload = await encryptText("secret-plan.docx", vaultDek);

    const entity = {
      encrypted: true,
      name: null,
      encryptedName: payload.ciphertext.slice(0, -4) + "AAAA",
      nameIv: payload.iv
    };

    await expect(resolveDisplayName(entity, vaultDek)).rejects.toThrow(
      NameDecryptionError
    );
  });

  it("throws NameDecryptionError when an encrypted entity is missing its ciphertext fields", async () => {
    const vaultDek = await generateAesKey();

    const entity = {
      encrypted: true,
      name: null,
      encryptedName: null,
      nameIv: null
    };

    await expect(resolveDisplayName(entity, vaultDek)).rejects.toThrow(
      NameDecryptionError
    );
  });
});
