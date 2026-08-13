/**
 * Resolves the display name for a file or folder. A legacy (plaintext)
 * entity's `name` is returned unchanged. An encrypted entity's name is
 * decrypted client-side with the caller's already-unlocked vault DEK,
 * using the same Phase 0 `encryptText`/`decryptText` AES-256-GCM
 * primitive used for every other piece of client-side encryption in this
 * app — no new crypto construction is introduced here.
 *
 * The decrypted string this returns is a plain in-memory JS value: it
 * lives only in whatever local variable, React state, or closure the
 * caller puts it in, for as long as that lives. Nothing in this module
 * writes it to localStorage, sessionStorage, IndexedDB, or any network
 * request — it is never persisted or sent anywhere.
 */
import { decryptText } from "@/lib/crypto";

export class NameDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NameDecryptionError";
  }
}

/** The subset of a FileDTO/FolderDTO/PathSegment needed to resolve a display name. */
export interface NamedEntity {
  encrypted: boolean;
  name: string | null;
  encryptedName: string | null;
  nameIv: string | null;
}

/**
 * Resolves `entity`'s real name. Never returns ciphertext, a blank
 * string, or a placeholder in place of a name it couldn't decrypt —
 * every failure mode throws `NameDecryptionError` instead, so a caller
 * can never accidentally render the wrong thing as if it were correct.
 */
export async function resolveDisplayName(
  entity: NamedEntity,
  vaultDek: CryptoKey | undefined
): Promise<string> {
  if (!entity.encrypted) {
    if (entity.name === null) {
      throw new NameDecryptionError(
        "This entity is not marked encrypted but has no plaintext name"
      );
    }
    return entity.name;
  }

  if (!vaultDek) {
    throw new NameDecryptionError(
      "Vault is locked: this name can only be decrypted with the unlocked vault key"
    );
  }

  if (!entity.encryptedName || !entity.nameIv) {
    throw new NameDecryptionError(
      "Encrypted entity is missing its name ciphertext"
    );
  }

  try {
    return await decryptText(
      { ciphertext: entity.encryptedName, iv: entity.nameIv },
      vaultDek
    );
  } catch {
    throw new NameDecryptionError(
      "Failed to decrypt name: wrong vault key or corrupted data"
    );
  }
}
