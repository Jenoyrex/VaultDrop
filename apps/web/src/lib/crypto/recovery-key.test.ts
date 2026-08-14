import { describe, expect, it } from "vitest";
import { generateRandomBytes } from "./random.js";
import { formatRecoveryKey, generateRecoveryKey, parseRecoveryKey } from "./recovery-key.js";

describe("generateRecoveryKey", () => {
  it("produces 32 raw bytes and a VDR1-prefixed formatted code", () => {
    const { bytes, formatted } = generateRecoveryKey();
    expect(bytes.length).toBe(32);
    expect(formatted.startsWith("VDR1-")).toBe(true);
  });

  it("never produces the same key twice", () => {
    const a = generateRecoveryKey();
    const b = generateRecoveryKey();
    expect(a.formatted).not.toBe(b.formatted);
  });
});

describe("formatRecoveryKey / parseRecoveryKey", () => {
  it("round-trips: parsing a formatted key recovers the exact original bytes", () => {
    const bytes = generateRandomBytes(32);
    const formatted = formatRecoveryKey(bytes);
    const parsed = parseRecoveryKey(formatted);
    expect(Array.from(parsed)).toEqual(Array.from(bytes));
  });

  it("round-trips across many random keys", () => {
    for (let i = 0; i < 25; i++) {
      const bytes = generateRandomBytes(32);
      const parsed = parseRecoveryKey(formatRecoveryKey(bytes));
      expect(Array.from(parsed)).toEqual(Array.from(bytes));
    }
  });

  it("is tolerant of lowercase input and surrounding whitespace", () => {
    const bytes = generateRandomBytes(32);
    const formatted = formatRecoveryKey(bytes);
    const messy = `  ${formatted.toLowerCase()}  `;
    expect(Array.from(parseRecoveryKey(messy))).toEqual(Array.from(bytes));
  });

  it("groups the encoded body into blocks of 4 after the VDR1 prefix", () => {
    const bytes = generateRandomBytes(32);
    const formatted = formatRecoveryKey(bytes);
    const groups = formatted.split("-");
    expect(groups[0]).toBe("VDR1");
    for (const group of groups.slice(1, -1)) {
      expect(group.length).toBe(4);
    }
  });

  it("rejects a key with the wrong prefix", () => {
    expect(() => parseRecoveryKey("XYZ1-AAAA-BBBB")).toThrow(/format not recognized/i);
  });

  it("rejects a key with an invalid character", () => {
    const bytes = generateRandomBytes(32);
    const formatted = formatRecoveryKey(bytes);
    const [prefix, ...groups] = formatted.split("-");
    // "I" is deliberately excluded from the Crockford alphabet used here.
    // Corrupt a character in the encoded body, not the "VDR1" prefix
    // (which would just trigger the wrong-prefix error instead).
    const corruptedGroups = [`I${groups[0]!.slice(1)}`, ...groups.slice(1)];
    const corrupted = [prefix, ...corruptedGroups].join("-");
    expect(() => parseRecoveryKey(corrupted)).toThrow(/invalid character/i);
  });

  it("rejects a truncated key (wrong decoded length)", () => {
    const bytes = generateRandomBytes(32);
    const formatted = formatRecoveryKey(bytes);
    const truncated = formatted.slice(0, formatted.length - 10);
    expect(() => parseRecoveryKey(truncated)).toThrow(/wrong length/i);
  });
});
