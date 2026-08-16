/**
 * Wires the Phase 0 crypto primitives into the file-upload path. Every
 * function here runs entirely client-side: the file's plaintext name and
 * content, the fresh per-file key, and the vault DEK used to wrap/encrypt
 * with never leave the browser. Only ciphertext — the wrapped file key,
 * the encrypted name, and the ciphertext content stream — ever reaches
 * `fileApi.uploadEncrypted`; the server never receives this file's
 * plaintext name at all, not even transiently in a request.
 */
import type { FileEncryptionEnvelope } from "@vaultdrop/types";
import {
  generateAesKey,
  wrapKey,
  encryptText,
  encryptFileStreamWithEmbeddedNonce
} from "@/lib/crypto";
import { CURRENT_ENCRYPTION_VERSION } from "@/lib/vault-keys";

export interface PreparedEncryptedUpload {
  ciphertextStream: ReadableStream<Uint8Array>;
  envelope: FileEncryptionEnvelope;
  /** Base64-encoded AES-256-GCM ciphertext of `file.name`, encrypted directly with the vault DEK. */
  encryptedName: string;
  /** Base64-encoded 12-byte IV used for the name encryption above. */
  nameIv: string;
}

/**
 * Generates a fresh random AES-256-GCM key for `file`'s content, wraps it
 * with the caller's already-unwrapped vault DEK, and returns a chunked
 * ciphertext stream of the file's content alongside the wrapped-key
 * envelope that should accompany it to `POST /files/upload-encrypted`.
 * The per-file key itself is used only in memory here and is never
 * exported or sent anywhere in its raw form.
 *
 * `file.name` is encrypted separately, directly with `vaultDek` (not the
 * per-file content key) via the existing Phase 0 `encryptText` primitive
 * — the same construction used for folder names, which have no per-file
 * key at all.
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

  const nameCiphertext = await encryptText(file.name, vaultDek);

  return {
    ciphertextStream,
    envelope: {
      encryptionVersion: CURRENT_ENCRYPTION_VERSION,
      wrappedKeyCiphertext: wrapped.ciphertext,
      wrappedKeyIv: wrapped.iv
    },
    encryptedName: nameCiphertext.ciphertext,
    nameIv: nameCiphertext.iv
  };
}
