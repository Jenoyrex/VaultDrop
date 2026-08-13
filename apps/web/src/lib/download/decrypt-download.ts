/**
 * Wires the existing Phase 0 chunked-cipher primitives into the
 * download/preview paths (Checkpoint 5). Every function here runs
 * entirely client-side: the ciphertext arrives from the server exactly as
 * stored, and is decrypted only in the browser using the caller's
 * already-unwrapped vault DEK. Nothing here ever sends key material or
 * plaintext to the server.
 */
import { unwrapKey, decryptFileStreamWithEmbeddedNonce } from "@/lib/crypto";
import { fileApi } from "@/lib/api-client";

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionError";
  }
}

/** The subset of a FileDTO needed to fetch and decrypt its content. */
export interface EncryptableFile {
  id: string;
  mimeType: string;
  encrypted: boolean;
  wrappedKeyCiphertext: string | null;
  wrappedKeyIv: string | null;
}

/**
 * Unwraps `file`'s per-file content key using the caller's already-
 * unwrapped vault DEK. Rejects with `DecryptionError` if the vault DEK is
 * wrong or the wrapped key has been tampered with — AES-GCM's auth tag
 * makes both cases indistinguishable and undecryptable, which is exactly
 * the property wanted here (never silently produce a wrong key).
 */
export async function unwrapFileKey(
  file: Pick<EncryptableFile, "wrappedKeyCiphertext" | "wrappedKeyIv">,
  vaultDek: CryptoKey
): Promise<CryptoKey> {
  if (!file.wrappedKeyCiphertext || !file.wrappedKeyIv) {
    throw new DecryptionError(
      "File is missing its encryption key metadata"
    );
  }

  try {
    return await unwrapKey(
      { ciphertext: file.wrappedKeyCiphertext, iv: file.wrappedKeyIv },
      vaultDek,
      ["decrypt"]
    );
  } catch {
    throw new DecryptionError(
      "Failed to unwrap the file's encryption key: wrong vault key or corrupted key data"
    );
  }
}

/**
 * Streams `response`'s body through the Phase 0 chunked decryptor
 * (`decryptFileStreamWithEmbeddedNonce`) and materializes the result as a
 * `Blob` tagged with `mimeType`. Ciphertext is never buffered in full — it
 * is decrypted incrementally as it arrives off the network — but the
 * resulting plaintext is fully realized as a `Blob`, matching the existing
 * download/preview UX used for legacy files. Rejects with
 * `DecryptionError` (no partial/corrupt Blob is ever produced) if any
 * chunk fails GCM authentication — tampered ciphertext, truncation, or a
 * wrong key.
 */
export async function decryptResponseToBlob(
  response: Response,
  fileKey: CryptoKey,
  mimeType: string
): Promise<Blob> {
  if (!response.body) {
    throw new DecryptionError("Encrypted response has no body to decrypt");
  }

  const decryptedStream = decryptFileStreamWithEmbeddedNonce(
    response.body,
    fileKey
  );

  try {
    return await new Response(decryptedStream, {
      headers: mimeType ? { "Content-Type": mimeType } : undefined
    }).blob();
  } catch {
    throw new DecryptionError(
      "Failed to decrypt file: the data is corrupted, tampered with, or the key is wrong"
    );
  }
}

/**
 * Fetches `file`'s full content from `GET /files/:id/download`, decrypting
 * it client-side first when `file.encrypted` is true, and returns a
 * plaintext `Blob`. Legacy (non-encrypted) files are returned exactly as
 * the server sent them — no unwrap/decrypt call is made for them.
 */
export async function fetchFileBlob(
  file: EncryptableFile,
  token: string,
  vaultDek: CryptoKey | undefined
): Promise<Blob> {
  const response = await fileApi.download(file.id, token);

  if (!response.ok) {
    throw new Error("Download failed");
  }

  if (!file.encrypted) {
    return response.blob();
  }

  if (!vaultDek) {
    throw new DecryptionError("Vault is locked");
  }

  const fileKey = await unwrapFileKey(file, vaultDek);
  return decryptResponseToBlob(response, fileKey, file.mimeType);
}

/** Triggers a browser save of `blob` named `fileName` via a throwaway object URL. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = fileName;
  a.click();

  URL.revokeObjectURL(url);
}
