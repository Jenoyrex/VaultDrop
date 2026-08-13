/**
 * Wires the Phase 0 crypto primitives into the file-upload path. Every
 * function here runs entirely client-side: the file's plaintext, the
 * fresh per-file key, and the vault DEK used to wrap it never leave the
 * browser. Only the wrapped (still-encrypted) file key and the ciphertext
 * stream ever reach `fileApi.uploadEncrypted`.
 */
import type { FileEncryptionEnvelope } from "@vaultdrop/types";
import { generateAesKey, wrapKey, encryptFileStreamWithEmbeddedNonce } from "@/lib/crypto";
import { CURRENT_ENCRYPTION_VERSION } from "@/lib/vault-keys";

export interface PreparedEncryptedUpload {
  ciphertextStream: ReadableStream<Uint8Array>;
  envelope: FileEncryptionEnvelope;
}

/**
 * Generates a fresh random AES-256-GCM key for `file`, wraps it with the
 * caller's already-unwrapped vault DEK, and returns a chunked ciphertext
 * stream of the file's content alongside the wrapped-key envelope that
 * should accompany it to `POST /files/upload-encrypted`. The per-file key
 * itself is used only in memory here and is never exported or sent
 * anywhere in its raw form.
 */
export async function prepareEncryptedUpload(
  file: File,
  vaultDek: CryptoKey
): Promise<PreparedEncryptedUpload> {
  const fileKey = await generateAesKey();
  const wrapped = await wrapKey(fileKey, vaultDek);

  const ciphertextStream = encryptFileStreamWithEmbeddedNonce(
    file.stream(),
    fileKey
  );

  return {
    ciphertextStream,
    envelope: {
      encryptionVersion: CURRENT_ENCRYPTION_VERSION,
      wrappedKeyCiphertext: wrapped.ciphertext,
      wrappedKeyIv: wrapped.iv
    }
  };
}
