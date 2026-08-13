import { describe, expect, it } from "vitest";
import { deriveKek, DEFAULT_KDF_ITERATIONS } from "./kdf.js";
import { exportKeyRaw } from "./random.js";

describe("deriveKek", () => {
  it("uses the default iteration count when not specified", async () => {
    const { params } = await deriveKek("correct horse battery staple");
    expect(params.iterations).toBe(DEFAULT_KDF_ITERATIONS);
    expect(params.hash).toBe("SHA-256");
  });

  it("is deterministic: same password + same salt/iterations -> identical key", async () => {
    const first = await deriveKek("hunter2");
    const second = await deriveKek("hunter2", first.params);

    const firstRaw = await exportKeyRaw(first.key);
    const secondRaw = await exportKeyRaw(second.key);

    expect(Array.from(secondRaw)).toEqual(Array.from(firstRaw));
  });

  it("produces a different key for a different salt", async () => {
    const first = await deriveKek("hunter2");
    const second = await deriveKek("hunter2");

    expect(first.params.salt).not.toBe(second.params.salt);

    const firstRaw = await exportKeyRaw(first.key);
    const secondRaw = await exportKeyRaw(second.key);

    expect(Array.from(firstRaw)).not.toEqual(Array.from(secondRaw));
  });

  it("produces a different key for a different password, same salt", async () => {
    const first = await deriveKek("password-one");
    const second = await deriveKek("password-two", first.params);

    const firstRaw = await exportKeyRaw(first.key);
    const secondRaw = await exportKeyRaw(second.key);

    expect(Array.from(firstRaw)).not.toEqual(Array.from(secondRaw));
  });

  it("only allows the intended key usages", async () => {
    const { key } = await deriveKek("hunter2");
    expect(key.usages.sort()).toEqual(
      ["decrypt", "encrypt", "unwrapKey", "wrapKey"].sort()
    );
  });
});