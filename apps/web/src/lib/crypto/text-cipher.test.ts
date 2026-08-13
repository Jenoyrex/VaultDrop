import { describe, expect, it } from "vitest";
import { encryptText, decryptText } from "./text-cipher.js";
import { generateAesKey } from "./random.js";

describe("encryptText / decryptText", () => {
  it("round-trips an empty string", async () => {
    const key = await generateAesKey();
    const payload = await encryptText("", key);
    expect(await decryptText(payload, key)).toBe("");
  });

  it("round-trips ASCII text", async () => {
    const key = await generateAesKey();
    const payload = await encryptText("quarterly-report-final.pdf", key);
    expect(await decryptText(payload, key)).toBe(
      "quarterly-report-final.pdf"
    );
  });

  it("round-trips multi-byte UTF-8 text (emoji, non-Latin scripts)", async () => {
    const key = await generateAesKey();
    const text = "vacation photos 🏖️ 家族写真 résumé.docx";
    const payload = await encryptText(text, key);
    expect(await decryptText(payload, key)).toBe(text);
  });

  it("rejects decryption with the wrong key", async () => {
    const key = await generateAesKey();
    const wrongKey = await generateAesKey();
    const payload = await encryptText("secret-name", key);

    await expect(decryptText(payload, wrongKey)).rejects.toThrow();
  });

  it("rejects decryption of tampered ciphertext", async () => {
    const key = await generateAesKey();
    const payload = await encryptText("secret-name", key);
    const tampered = {
      ...payload,
      ciphertext: payload.ciphertext.slice(0, -4) + "AAAA"
    };

    await expect(decryptText(tampered, key)).rejects.toThrow();
  });

  it("rejects decryption with a tampered IV", async () => {
    const key = await generateAesKey();
    const payload = await encryptText("secret-name", key);
    const tampered = {
      ...payload,
      iv: payload.iv.slice(0, -2) + "AA"
    };

    await expect(decryptText(tampered, key)).rejects.toThrow();
  });
});