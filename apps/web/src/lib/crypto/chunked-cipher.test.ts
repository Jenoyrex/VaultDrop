import { describe, expect, it } from "vitest";
import {
  CHUNK_SIZE,
  NONCE_LENGTH,
  deriveChunkNonce,
  encryptFileStream,
  decryptFileStream,
  encryptFileStreamWithEmbeddedNonce,
  decryptFileStreamWithEmbeddedNonce
} from "./chunked-cipher.js";
import { generateAesKey, generateRandomBytes } from "./random.js";

function streamFromBytes(
  bytes: Uint8Array,
  feedChunkSize = 64 * 1024
): ReadableStream<Uint8Array> {
  let offset = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }

      const end = Math.min(offset + feedChunkSize, bytes.length);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    }
  });
}

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

async function roundTrip(plaintext: Uint8Array): Promise<Uint8Array> {
  const key = await generateAesKey();
  const baseNonce = generateRandomBytes(NONCE_LENGTH);

  const encrypted = encryptFileStream(
    streamFromBytes(plaintext),
    key,
    baseNonce
  );
  const encryptedBytes = await collectStream(encrypted);

  const decrypted = decryptFileStream(
    streamFromBytes(encryptedBytes),
    key,
    baseNonce
  );

  return collectStream(decrypted);
}

describe("deriveChunkNonce", () => {
  it("produces the correct length", () => {
    const base = generateRandomBytes(NONCE_LENGTH);
    expect(deriveChunkNonce(base, 0).length).toBe(NONCE_LENGTH);
  });

  it("never repeats across a large number of sequential indices", () => {
    const base = generateRandomBytes(NONCE_LENGTH);
    const seen = new Set<string>();

    for (let i = 0; i < 5000; i++) {
      const nonce = deriveChunkNonce(base, i);
      seen.add(Array.from(nonce).join(","));
    }

    expect(seen.size).toBe(5000);
  });

  it("does not mutate the input baseNonce", () => {
    const base = generateRandomBytes(NONCE_LENGTH);
    const before = Array.from(base);
    deriveChunkNonce(base, 42);
    expect(Array.from(base)).toEqual(before);
  });

  it("rejects a baseNonce of the wrong length", () => {
    expect(() => deriveChunkNonce(new Uint8Array(11), 0)).toThrow();
  });

  it("rejects a negative or non-integer chunk index", () => {
    const base = generateRandomBytes(NONCE_LENGTH);
    expect(() => deriveChunkNonce(base, -1)).toThrow();
    expect(() => deriveChunkNonce(base, 1.5)).toThrow();
  });
});

describe("encryptFileStream / decryptFileStream round-trips", () => {
  it("round-trips an empty input", async () => {
    const result = await roundTrip(new Uint8Array(0));
    expect(result.length).toBe(0);
  });

  it("round-trips a single small partial chunk", async () => {
    const plaintext = generateRandomBytes(123);
    const result = await roundTrip(plaintext);
    expect(Array.from(result)).toEqual(Array.from(plaintext));
  });

  it("round-trips exactly one full chunk", async () => {
    const plaintext = generateRandomBytes(CHUNK_SIZE);
    const result = await roundTrip(plaintext);
    expect(result.length).toBe(plaintext.length);
    expect(Array.from(result)).toEqual(Array.from(plaintext));
  });

  it("round-trips multiple full chunks plus a short final chunk", async () => {
    const plaintext = generateRandomBytes(CHUNK_SIZE * 2 + 777);
    const result = await roundTrip(plaintext);
    expect(result.length).toBe(plaintext.length);
    expect(Array.from(result)).toEqual(Array.from(plaintext));
  });

  it("round-trips through the embedded-nonce convenience wrapper", async () => {
    const key = await generateAesKey();
    const plaintext = generateRandomBytes(50_000);

    const encrypted = encryptFileStreamWithEmbeddedNonce(
      streamFromBytes(plaintext),
      key
    );
    const encryptedBytes = await collectStream(encrypted);

    const decrypted = decryptFileStreamWithEmbeddedNonce(
      streamFromBytes(encryptedBytes),
      key
    );
    const result = await collectStream(decrypted);

    expect(Array.from(result)).toEqual(Array.from(plaintext));
  });
});

describe("encryptFileStream / decryptFileStream tamper and corruption detection", () => {
  it("rejects decryption when a ciphertext byte is flipped", async () => {
    const key = await generateAesKey();
    const baseNonce = generateRandomBytes(NONCE_LENGTH);
    const plaintext = generateRandomBytes(1000);

    const encryptedBytes = await collectStream(
      encryptFileStream(streamFromBytes(plaintext), key, baseNonce)
    );

    const tampered = encryptedBytes.slice();
    // Flip a byte inside the first chunk's ciphertext (after the 4-byte
    // length prefix), which must fail tag verification.
    tampered[10] = tampered[10]! ^ 0xff;

    await expect(
      collectStream(
        decryptFileStream(streamFromBytes(tampered), key, baseNonce)
      )
    ).rejects.toThrow();
  });

  it("rejects decryption with the wrong key", async () => {
    const key = await generateAesKey();
    const wrongKey = await generateAesKey();
    const baseNonce = generateRandomBytes(NONCE_LENGTH);
    const plaintext = generateRandomBytes(1000);

    const encryptedBytes = await collectStream(
      encryptFileStream(streamFromBytes(plaintext), key, baseNonce)
    );

    await expect(
      collectStream(
        decryptFileStream(streamFromBytes(encryptedBytes), wrongKey, baseNonce)
      )
    ).rejects.toThrow();
  });

  it("rejects decryption with the wrong base nonce", async () => {
    const key = await generateAesKey();
    const baseNonce = generateRandomBytes(NONCE_LENGTH);
    const wrongBaseNonce = generateRandomBytes(NONCE_LENGTH);
    const plaintext = generateRandomBytes(1000);

    const encryptedBytes = await collectStream(
      encryptFileStream(streamFromBytes(plaintext), key, baseNonce)
    );

    await expect(
      collectStream(
        decryptFileStream(
          streamFromBytes(encryptedBytes),
          key,
          wrongBaseNonce
        )
      )
    ).rejects.toThrow();
  });

  it("rejects a stream truncated mid-chunk", async () => {
    const key = await generateAesKey();
    const baseNonce = generateRandomBytes(NONCE_LENGTH);
    const plaintext = generateRandomBytes(CHUNK_SIZE + 500);

    const encryptedBytes = await collectStream(
      encryptFileStream(streamFromBytes(plaintext), key, baseNonce)
    );

    const truncated = encryptedBytes.slice(0, encryptedBytes.length - 10);

    await expect(
      collectStream(
        decryptFileStream(streamFromBytes(truncated), key, baseNonce)
      )
    ).rejects.toThrow(/truncated/i);
  });

  it("rejects a corrupted (oversized) chunk-length prefix", async () => {
    const key = await generateAesKey();
    const baseNonce = generateRandomBytes(NONCE_LENGTH);
    const plaintext = generateRandomBytes(1000);

    const encryptedBytes = await collectStream(
      encryptFileStream(streamFromBytes(plaintext), key, baseNonce)
    );

    const corrupted = encryptedBytes.slice();
    const view = new DataView(corrupted.buffer);
    view.setUint32(0, 0xffffffff, false); // absurd length prefix

    await expect(
      collectStream(
        decryptFileStream(streamFromBytes(corrupted), key, baseNonce)
      )
    ).rejects.toThrow(/truncated/i);
  });
});