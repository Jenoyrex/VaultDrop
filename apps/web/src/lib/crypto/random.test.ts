import { describe, expect, it } from "vitest";
import {
  generateRandomBytes,
  generateAesKey,
  exportKeyRaw,
  importAesKeyRaw
} from "./random.js";

describe("generateRandomBytes", () => {
  it("returns the requested length", () => {
    expect(generateRandomBytes(12).length).toBe(12);
    expect(generateRandomBytes(32).length).toBe(32);
  });

  it("is not all-zero and differs across calls", () => {
    const a = generateRandomBytes(32);
    const b = generateRandomBytes(32);

    expect(a.every((byte) => byte === 0)).toBe(false);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("handles requests larger than the 65536-byte getRandomValues limit", () => {
    // crypto.getRandomValues() throws for single requests over 65536
    // bytes — this exercises the chunking that works around that.
    const large = generateRandomBytes(200_000);
    expect(large.length).toBe(200_000);
    expect(large.every((byte) => byte === 0)).toBe(false);
  });
});

describe("generateAesKey / exportKeyRaw / importAesKeyRaw", () => {
  it("generates an AES-256 key", async () => {
    const key = await generateAesKey();
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(key.extractable).toBe(true);
  });

  it("round-trips raw key bytes through export/import", async () => {
    const key = await generateAesKey();
    const raw = await exportKeyRaw(key);

    expect(raw.length).toBe(32);

    const imported = await importAesKeyRaw(raw);
    const reExported = await exportKeyRaw(imported);

    expect(Array.from(reExported)).toEqual(Array.from(raw));
  });
});