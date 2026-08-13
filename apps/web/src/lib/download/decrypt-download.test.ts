import { describe, expect, it, vi, afterEach } from "vitest";
import {
  generateAesKey,
  wrapKey,
  encryptFileStreamWithEmbeddedNonce
} from "@/lib/crypto";
import {
  DecryptionError,
  unwrapFileKey,
  decryptResponseToBlob,
  fetchFileBlob
} from "./decrypt-download.js";

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
}

async function collectStream(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array<ArrayBuffer>> {
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

async function buildCiphertext(
  plaintext: string,
  fileKey: CryptoKey
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new TextEncoder().encode(plaintext);
  const encryptedStream = encryptFileStreamWithEmbeddedNonce(
    streamFromBytes(bytes),
    fileKey
  );
  return collectStream(encryptedStream);
}

describe("unwrapFileKey", () => {
  it("unwraps a file key that was wrapped with the same vault DEK", async () => {
    const vaultDek = await generateAesKey();
    const fileKey = await generateAesKey();
    const wrapped = await wrapKey(fileKey, vaultDek);

    const unwrapped = await unwrapFileKey(
      { wrappedKeyCiphertext: wrapped.ciphertext, wrappedKeyIv: wrapped.iv },
      vaultDek
    );

    // Prove it's usable for decryption by round-tripping a chunk with it.
    const ciphertext = await buildCiphertext("round trip check", fileKey);
    const blob = await decryptResponseToBlob(
      new Response(new Blob([ciphertext])),
      unwrapped,
      "text/plain"
    );
    expect(await blob.text()).toBe("round trip check");
  });

  it("rejects with DecryptionError when unwrapped with the wrong vault DEK", async () => {
    const rightDek = await generateAesKey();
    const wrongDek = await generateAesKey();
    const fileKey = await generateAesKey();
    const wrapped = await wrapKey(fileKey, rightDek);

    await expect(
      unwrapFileKey(
        { wrappedKeyCiphertext: wrapped.ciphertext, wrappedKeyIv: wrapped.iv },
        wrongDek
      )
    ).rejects.toThrow(DecryptionError);
  });

  it("rejects with DecryptionError when the file is missing wrap metadata", async () => {
    const vaultDek = await generateAesKey();

    await expect(
      unwrapFileKey(
        { wrappedKeyCiphertext: null, wrappedKeyIv: null },
        vaultDek
      )
    ).rejects.toThrow(DecryptionError);
  });
});

describe("decryptResponseToBlob", () => {
  it("decrypts a streamed ciphertext response back to the original plaintext, tagged with the given mime type", async () => {
    const fileKey = await generateAesKey();
    const ciphertext = await buildCiphertext("hello from the vault", fileKey);

    const blob = await decryptResponseToBlob(
      new Response(new Blob([ciphertext])),
      fileKey,
      "text/plain"
    );

    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("hello from the vault");
  });

  it("rejects with DecryptionError when decrypted with the wrong file key", async () => {
    const rightKey = await generateAesKey();
    const wrongKey = await generateAesKey();
    const ciphertext = await buildCiphertext("secret contents", rightKey);

    await expect(
      decryptResponseToBlob(
        new Response(new Blob([ciphertext])),
        wrongKey,
        "text/plain"
      )
    ).rejects.toThrow(DecryptionError);
  });

  it("rejects with DecryptionError on corrupted/tampered ciphertext", async () => {
    const fileKey = await generateAesKey();
    const ciphertext = await buildCiphertext("tamper me", fileKey);

    // Flip a byte inside the framed ciphertext (past the 12-byte nonce +
    // 4-byte length prefix), simulating corruption or tampering in transit.
    const tampered = ciphertext.slice();
    tampered[20] = tampered[20]! ^ 0xff;

    await expect(
      decryptResponseToBlob(
        new Response(new Blob([tampered])),
        fileKey,
        "text/plain"
      )
    ).rejects.toThrow(DecryptionError);
  });

  it("rejects with DecryptionError when the response has no body", async () => {
    const fileKey = await generateAesKey();

    await expect(
      decryptResponseToBlob(new Response(null), fileKey, "text/plain")
    ).rejects.toThrow(DecryptionError);
  });
});

describe("fetchFileBlob", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("full round trip: fetches, unwraps the file key, and decrypts an encrypted file back to its original bytes", async () => {
    const vaultDek = await generateAesKey();
    const fileKey = await generateAesKey();
    const wrapped = await wrapKey(fileKey, vaultDek);
    const ciphertext = await buildCiphertext("the whole round trip", fileKey);

    global.fetch = vi.fn(
      async () => new Response(new Blob([ciphertext]), { status: 200 })
    ) as unknown as typeof fetch;

    const blob = await fetchFileBlob(
      {
        id: "file-1",
        mimeType: "text/plain",
        encrypted: true,
        wrappedKeyCiphertext: wrapped.ciphertext,
        wrappedKeyIv: wrapped.iv
      },
      "test-token",
      vaultDek
    );

    expect(await blob.text()).toBe("the whole round trip");
  });

  it("does not attempt to unwrap or decrypt a legacy (non-encrypted) file", async () => {
    global.fetch = vi.fn(
      async () => new Response("plain legacy bytes", { status: 200 })
    ) as unknown as typeof fetch;

    const blob = await fetchFileBlob(
      {
        id: "file-2",
        mimeType: "text/plain",
        encrypted: false,
        wrappedKeyCiphertext: null,
        wrappedKeyIv: null
      },
      "test-token",
      undefined
    );

    expect(await blob.text()).toBe("plain legacy bytes");
  });

  it("throws DecryptionError for an encrypted file when the vault is locked (no DEK available)", async () => {
    global.fetch = vi.fn(
      async () => new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 })
    ) as unknown as typeof fetch;

    await expect(
      fetchFileBlob(
        {
          id: "file-3",
          mimeType: "image/png",
          encrypted: true,
          wrappedKeyCiphertext: "abc",
          wrappedKeyIv: "def"
        },
        "test-token",
        undefined
      )
    ).rejects.toThrow(DecryptionError);
  });

  it("throws when the server responds with a non-2xx status", async () => {
    global.fetch = vi.fn(
      async () => new Response("", { status: 404 })
    ) as unknown as typeof fetch;

    await expect(
      fetchFileBlob(
        {
          id: "file-4",
          mimeType: "text/plain",
          encrypted: false,
          wrappedKeyCiphertext: null,
          wrappedKeyIv: null
        },
        "test-token",
        undefined
      )
    ).rejects.toThrow("Download failed");
  });
});
