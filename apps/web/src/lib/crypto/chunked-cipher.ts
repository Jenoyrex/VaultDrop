import { generateRandomBytes } from "./random.js";

/** Plaintext bytes read per chunk before encryption. */
export const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB

/** AES-GCM nonce length, in bytes. */
export const NONCE_LENGTH = 12;

/** AES-GCM authentication tag length, in bytes (appended to ciphertext by Web Crypto). */
export const TAG_LENGTH = 16;

/** Length, in bytes, of the big-endian chunk-length prefix written before each frame. */
const LENGTH_PREFIX_BYTES = 4;

/**
 * Derives the per-chunk nonce from a file's random base nonce and the
 * chunk's sequential index: the last 4 bytes of `baseNonce` are XORed
 * with the big-endian 32-bit `chunkIndex`. This guarantees a unique
 * nonce per chunk within a file — reusing a (key, nonce) pair under
 * AES-GCM is catastrophic, so this construction is the single most
 * security-critical piece of this module. See chunked-cipher.test.ts
 * for uniqueness verification.
 */
export function deriveChunkNonce(
  baseNonce: Uint8Array<ArrayBuffer>,
  chunkIndex: number
): Uint8Array<ArrayBuffer> {
  if (baseNonce.length !== NONCE_LENGTH) {
    throw new Error(
      `baseNonce must be ${NONCE_LENGTH} bytes, got ${baseNonce.length}`
    );
  }

  if (chunkIndex < 0 || !Number.isInteger(chunkIndex)) {
    throw new Error("chunkIndex must be a non-negative integer");
  }

  const nonce = baseNonce.slice();
  const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);

  const counterOffset = NONCE_LENGTH - 4;
  const currentCounter = view.getUint32(counterOffset, false);
  view.setUint32(counterOffset, currentCounter ^ chunkIndex, false);

  return nonce;
}

function concatBytes(
  a: Uint8Array,
  b: Uint8Array
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function frameChunk(ciphertext: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const framed = new Uint8Array(LENGTH_PREFIX_BYTES + ciphertext.length);
  const view = new DataView(framed.buffer);
  view.setUint32(0, ciphertext.length, false);
  framed.set(ciphertext, LENGTH_PREFIX_BYTES);
  return framed;
}

/**
 * Encrypts a plaintext byte stream, chunk by chunk, without ever holding
 * the whole input in memory at once. Each chunk is independently
 * AES-256-GCM encrypted and framed as `[4-byte length][ciphertext+tag]`.
 * If the input is empty, exactly one (empty-plaintext) chunk is still
 * emitted, so encrypt/decrypt round-trip consistently for empty files.
 */
export function encryptFileStream(
  plaintext: ReadableStream<Uint8Array>,
  key: CryptoKey,
  baseNonce: Uint8Array<ArrayBuffer>
): ReadableStream<Uint8Array> {
  const reader = plaintext.getReader();
  let buffered: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let chunkIndex = 0;
  let sourceExhausted = false;

  async function encryptAndFrame(
    chunk: Uint8Array<ArrayBuffer>
  ): Promise<Uint8Array<ArrayBuffer>> {
    const nonce = deriveChunkNonce(baseNonce, chunkIndex);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, chunk)
    );
    chunkIndex += 1;
    return frameChunk(ciphertext);
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (buffered.length < CHUNK_SIZE && !sourceExhausted) {
        const { value, done } = await reader.read();

        if (done) {
          sourceExhausted = true;
          break;
        }

        buffered = concatBytes(buffered, value);
      }

      if (buffered.length >= CHUNK_SIZE) {
        const chunk = buffered.slice(0, CHUNK_SIZE);
        buffered = buffered.slice(CHUNK_SIZE);
        controller.enqueue(await encryptAndFrame(chunk));
        return;
      }

      if (buffered.length > 0) {
        const chunk = buffered;
        buffered = new Uint8Array(0);
        controller.enqueue(await encryptAndFrame(chunk));
        return;
      }

      if (chunkIndex === 0) {
        // Truly empty input: still emit exactly one empty-plaintext chunk.
        controller.enqueue(await encryptAndFrame(new Uint8Array(0)));
      }

      controller.close();
    },
    async cancel(reason) {
      await reader.cancel(reason);
    }
  });
}

/**
 * Decrypts a stream produced by `encryptFileStream`. Rejects (the stream
 * errors) if any chunk's authentication tag fails to verify — including
 * tampered ciphertext or a corrupted length prefix — rather than ever
 * producing partial or incorrect plaintext.
 *
 * Per-chunk GCM tags alone cannot detect whole trailing chunks being
 * removed: each remaining chunk still verifies correctly on its own, so a
 * ciphertext with its tail cut off at a frame boundary would otherwise
 * decrypt "successfully" to a silently-shortened plaintext. When the
 * caller knows the ciphertext's true total length in advance (from a
 * source it trusts independently of the bytes being decrypted, e.g.
 * server-recorded upload size), passing it as `expectedTotalBytes` closes
 * that gap: decryption fails if the stream ends having produced a
 * different number of bytes than expected, even though every individual
 * chunk it did see was authentic.
 */
export function decryptFileStream(
  ciphertext: ReadableStream<Uint8Array>,
  key: CryptoKey,
  baseNonce: Uint8Array<ArrayBuffer>,
  expectedTotalBytes?: number
): ReadableStream<Uint8Array> {
  if (
    expectedTotalBytes !== undefined &&
    (!Number.isInteger(expectedTotalBytes) || expectedTotalBytes < 0)
  ) {
    throw new Error("expectedTotalBytes must be a non-negative integer");
  }

  const reader = ciphertext.getReader();
  let buffered: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let chunkIndex = 0;
  let sourceExhausted = false;
  let totalBytesRead = 0;

  async function fillUntil(minLength: number): Promise<void> {
    while (buffered.length < minLength && !sourceExhausted) {
      const { value, done } = await reader.read();

      if (done) {
        sourceExhausted = true;
        break;
      }

      totalBytesRead += value.length;
      buffered = concatBytes(buffered, value);
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      await fillUntil(LENGTH_PREFIX_BYTES);

      if (buffered.length === 0 && sourceExhausted) {
        if (
          expectedTotalBytes !== undefined &&
          totalBytesRead !== expectedTotalBytes
        ) {
          controller.error(
            new Error(
              "Corrupted encrypted stream: ciphertext length does not match the expected size (truncated or tampered)"
            )
          );
          return;
        }

        controller.close();
        return;
      }

      if (buffered.length < LENGTH_PREFIX_BYTES) {
        controller.error(
          new Error(
            "Corrupted encrypted stream: truncated chunk-length prefix"
          )
        );
        return;
      }

      const lengthView = new DataView(
        buffered.buffer,
        buffered.byteOffset,
        LENGTH_PREFIX_BYTES
      );
      const chunkCiphertextLength = lengthView.getUint32(0, false);

      await fillUntil(LENGTH_PREFIX_BYTES + chunkCiphertextLength);

      if (buffered.length < LENGTH_PREFIX_BYTES + chunkCiphertextLength) {
        controller.error(
          new Error(
            "Corrupted encrypted stream: truncated chunk ciphertext"
          )
        );
        return;
      }

      const chunkCiphertext = buffered.slice(
        LENGTH_PREFIX_BYTES,
        LENGTH_PREFIX_BYTES + chunkCiphertextLength
      );
      buffered = buffered.slice(LENGTH_PREFIX_BYTES + chunkCiphertextLength);

      const nonce = deriveChunkNonce(baseNonce, chunkIndex);
      chunkIndex += 1;

      try {
        const plaintext = new Uint8Array(
          await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: nonce },
            key,
            chunkCiphertext
          )
        );
        controller.enqueue(plaintext);
      } catch {
        controller.error(
          new Error(
            "Failed to decrypt chunk: authentication tag mismatch (tampered or corrupted data, or wrong key)"
          )
        );
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    }
  });
}

/**
 * Convenience wrapper around `encryptFileStream` that writes the random
 * 12-byte base nonce as the first bytes of the output stream, so the
 * resulting ciphertext is self-describing for framing purposes (the
 * caller still needs the *key* out-of-band, same as any encrypted blob).
 */
export function encryptFileStreamWithEmbeddedNonce(
  plaintext: ReadableStream<Uint8Array>,
  key: CryptoKey
): ReadableStream<Uint8Array> {
  const baseNonce = generateRandomBytes(NONCE_LENGTH);
  const inner = encryptFileStream(plaintext, key, baseNonce);
  let nonceEmitted = false;
  const innerReader = inner.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!nonceEmitted) {
        nonceEmitted = true;
        controller.enqueue(baseNonce.slice());
        return;
      }

      const { value, done } = await innerReader.read();

      if (done) {
        controller.close();
        return;
      }

      controller.enqueue(value);
    },
    async cancel(reason) {
      await innerReader.cancel(reason);
    }
  });
}

/**
 * Convenience wrapper around `decryptFileStream` that reads the 12-byte
 * base nonce from the front of the stream (as written by
 * `encryptFileStreamWithEmbeddedNonce`) before decrypting the rest.
 *
 * `expectedTotalBytes` is the ciphertext's true total length (nonce +
 * every framed chunk), from a source the caller trusts independently of
 * the stream being decrypted — e.g. the byte count the server recorded
 * while the upload was originally written to storage. It is required
 * (not optional) so that every production call site is forced to supply
 * it, guaranteeing truncation is always caught before plaintext is
 * returned. See `decryptFileStream` for why a per-chunk auth tag alone
 * can't detect whole trailing chunks being removed.
 */
export function decryptFileStreamWithEmbeddedNonce(
  ciphertext: ReadableStream<Uint8Array>,
  key: CryptoKey,
  expectedTotalBytes: number
): ReadableStream<Uint8Array> {
  if (
    !Number.isInteger(expectedTotalBytes) ||
    expectedTotalBytes < NONCE_LENGTH
  ) {
    throw new Error(
      `expectedTotalBytes must be an integer of at least ${NONCE_LENGTH} bytes`
    );
  }

  const reader = ciphertext.getReader();
  let buffered: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let sourceExhausted = false;
  let inner: ReadableStream<Uint8Array> | null = null;
  let innerReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  async function fillUntil(minLength: number): Promise<void> {
    while (buffered.length < minLength && !sourceExhausted) {
      const { value, done } = await reader.read();

      if (done) {
        sourceExhausted = true;
        break;
      }

      buffered = concatBytes(buffered, value);
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!inner) {
        await fillUntil(NONCE_LENGTH);

        if (buffered.length < NONCE_LENGTH) {
          controller.error(
            new Error(
              "Corrupted encrypted stream: missing or truncated base nonce"
            )
          );
          return;
        }

        const baseNonce = buffered.slice(0, NONCE_LENGTH);
        buffered = buffered.slice(NONCE_LENGTH);

        const rest = new ReadableStream<Uint8Array>({
          start(restController) {
            if (buffered.length > 0) {
              restController.enqueue(buffered);
              buffered = new Uint8Array(0);
            }
          },
          async pull(restController) {
            const { value, done } = await reader.read();

            if (done) {
              restController.close();
              return;
            }

            restController.enqueue(value);
          }
        });

        inner = decryptFileStream(
          rest,
          key,
          baseNonce,
          expectedTotalBytes - NONCE_LENGTH
        );
        innerReader = inner.getReader();
      }

      const { value, done } = await innerReader!.read();

      if (done) {
        controller.close();
        return;
      }

      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
      if (innerReader) {
        await innerReader.cancel(reason);
      }
    }
  });
}