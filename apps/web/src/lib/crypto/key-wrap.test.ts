import { describe, expect, it } from "vitest";
import { wrapKey, unwrapKey } from "./key-wrap.js";
import { generateAesKey, exportKeyRaw } from "./random.js";

describe("wrapKey / unwrapKey", () => {
  it("round-trips a key's raw bytes through wrap/unwrap", async () => {
    const dek = await generateAesKey();
    const kek = await generateAesKey();

    const wrapped = await wrapKey(dek, kek);
    const unwrapped = await unwrapKey(wrapped, kek, ["encrypt", "decrypt"]);

    const originalRaw = await exportKeyRaw(dek);
    const unwrappedRaw = await exportKeyRaw(unwrapped);

    expect(Array.from(unwrappedRaw)).toEqual(Array.from(originalRaw));
  });

  it("uses a fresh IV on every wrap call, even for the same key", async () => {
    const dek = await generateAesKey();
    const kek = await generateAesKey();

    const first = await wrapKey(dek, kek);
    const second = await wrapKey(dek, kek);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejects unwrapping with the wrong wrapping key", async () => {
    const dek = await generateAesKey();
    const kek = await generateAesKey();
    const wrongKek = await generateAesKey();

    const wrapped = await wrapKey(dek, kek);

    await expect(
      unwrapKey(wrapped, wrongKek, ["encrypt", "decrypt"])
    ).rejects.toThrow();
  });

  it("rejects unwrapping a tampered ciphertext", async () => {
    const dek = await generateAesKey();
    const kek = await generateAesKey();

    const wrapped = await wrapKey(dek, kek);
    const tampered = {
      ...wrapped,
      ciphertext: wrapped.ciphertext.slice(0, -4) + "AAAA"
    };

    await expect(
      unwrapKey(tampered, kek, ["encrypt", "decrypt"])
    ).rejects.toThrow();
  });

  it("rejects unwrapping with a tampered IV", async () => {
    const dek = await generateAesKey();
    const kek = await generateAesKey();

    const wrapped = await wrapKey(dek, kek);
    const tampered = {
      ...wrapped,
      iv: wrapped.iv.slice(0, -2) + "AA"
    };

    await expect(
      unwrapKey(tampered, kek, ["encrypt", "decrypt"])
    ).rejects.toThrow();
  });
});