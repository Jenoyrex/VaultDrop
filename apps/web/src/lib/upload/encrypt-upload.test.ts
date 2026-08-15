import { describe, expect, it } from "vitest";
import { generateAesKey, unwrapKey, decryptFileStreamWithEmbeddedNonce } from "@/lib/crypto";
import { prepareEncryptedUpload } from "./encrypt-upload.js";

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
}

const FILE_KEY_USAGES: KeyUsage[] = ["encrypt", "decrypt", "wrapKey", "unwrapKey"];

async function collectStream(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return out;
}

function containsSubsequence(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;

  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

const MARKER = "THIS-IS-A-SECRET-MARKER-8f3c9a1e";

describe("prepareEncryptedUpload", () => {
  it("round-trips: decrypting the produced stream with the unwrapped file key recovers the exact original bytes", async () => {
    const vaultDek = await generateAesKey();
    const plaintext = `some file contents\n${MARKER}\nmore contents`;
    const file = new File([plaintext], "secret.txt", { type: "text/plain" });

    const { ciphertextStream, envelope } = await prepareEncryptedUpload(
      file,
      vaultDek
    );

    const fileKey = await unwrapKey(
      {
        ciphertext: envelope.wrappedKeyCiphertext,
        iv: envelope.wrappedKeyIv
      },
      vaultDek,
      FILE_KEY_USAGES
    );

    const ciphertextBytes = await collectStream(ciphertextStream);

    const decrypted = await collectStream(
      decryptFileStreamWithEmbeddedNonce(
        streamFromBytes(ciphertextBytes),
        fileKey,
        ciphertextBytes.length
      )
    );

    expect(new TextDecoder().decode(decrypted)).toBe(plaintext);
  });

  it("rejects unwrapping the file key with the wrong vault DEK", async () => {
    const vaultDek = await generateAesKey();
    const wrongDek = await generateAesKey();
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    const { envelope } = await prepareEncryptedUpload(file, vaultDek);

    await expect(
      unwrapKey(
        {
          ciphertext: envelope.wrappedKeyCiphertext,
          iv: envelope.wrappedKeyIv
        },
        wrongDek,
        FILE_KEY_USAGES
      )
    ).rejects.toThrow();
  });

  it("never emits the plaintext bytes on the wire — the raw ciphertext stream never contains the marker", async () => {
    const vaultDek = await generateAesKey();
    const plaintext = `preamble\n${MARKER}\npostamble`;
    const file = new File([plaintext], "secret.txt", { type: "text/plain" });

    const { ciphertextStream } = await prepareEncryptedUpload(file, vaultDek);

    const wireBytes = await collectStream(ciphertextStream);
    const markerBytes = new TextEncoder().encode(MARKER);

    expect(containsSubsequence(wireBytes, markerBytes)).toBe(false);
    // Sanity check the helper itself against the plaintext, so a bug in
    // containsSubsequence can't silently make this test meaningless.
    expect(
      containsSubsequence(new TextEncoder().encode(plaintext), markerBytes)
    ).toBe(true);
  });

  it("generates a fresh, independent file key per call (different ciphertext and wrap for the same file)", async () => {
    const vaultDek = await generateAesKey();
    const file = new File(["same content"], "same.txt", { type: "text/plain" });

    const first = await prepareEncryptedUpload(file, vaultDek);
    const second = await prepareEncryptedUpload(file, vaultDek);

    expect(first.envelope.wrappedKeyCiphertext).not.toBe(
      second.envelope.wrappedKeyCiphertext
    );
  });
});
