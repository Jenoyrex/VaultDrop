/**
 * Domain entities mirrored from the Prisma schema.
 * Kept independent from `@prisma/client` so the web app never needs
 * the Prisma runtime as a dependency.
 */

export interface UserDTO {
  id: string;
  username: string;
  createdAt: string;
}

export interface VaultDTO {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;

  /**
   * Zero-knowledge encryption metadata, owner-scoped only (every endpoint
   * returning a VaultDTO already checks vault ownership before building
   * one). All fields are null together on a legacy, pre-Phase-1 vault
   * that has no client-side encryption — its files are plain. Populated
   * together once a vault is created with an encryption envelope.
   *
   * Deliberately excludes the recovery-wrapped DEK: that material must
   * never flow through general vault responses like this one.
   */
  encryptionVersion: number | null;
  /** Base64-encoded 16-byte PBKDF2 salt used to derive the KEK. */
  kekSalt: string | null;
  /** PBKDF2 iteration count used to derive the KEK. */
  kekIterations: number | null;
  /** PBKDF2 hash algorithm used to derive the KEK, e.g. "SHA-256". */
  kekHash: string | null;
  /** Base64-encoded AES-256-GCM ciphertext of the DEK, wrapped by the KEK. */
  wrappedDekCiphertext: string | null;
  /** Base64-encoded 12-byte IV used for the KEK-wrap above. */
  wrappedDekIv: string | null;
}

export interface FolderDTO {
  id: string;
  /** Plaintext name. Non-null for a legacy folder (`encrypted` false); null when `encrypted` is true. */
  name: string | null;
  vaultId: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;

  /**
   * Zero-knowledge folder name encryption metadata. `encrypted` is
   * `false` (and the cipher fields `null`) for a legacy folder, or a
   * folder in an unencrypted vault, whose `name` is plaintext. When
   * `true`, `name` is null and the folder's real name is only available
   * as `encryptedName`/`nameIv`, AES-256-GCM ciphertext under the owning
   * vault's DEK — opaque to the server, only decryptable client-side.
   */
  encrypted: boolean;
  /** Base64-encoded AES-256-GCM ciphertext of the folder's name, encrypted directly with the vault DEK. */
  encryptedName: string | null;
  /** Base64-encoded 12-byte IV used for the name encryption above. */
  nameIv: string | null;
}

export type StorageProvider = "LOCAL" | "CLOUD";

export interface FileDTO {
  id: string;
  /** Plaintext name. Non-null for a legacy file (`encrypted` false); null when `encrypted` is true. */
  name: string | null;
  mimeType: string;
  sizeBytes: number;
  vaultId: string;
  folderId: string | null;
  storageProvider: StorageProvider;
  storageKey: string;
  createdAt: string;
  updatedAt: string;

  /**
   * Zero-knowledge file content (and name) encryption metadata.
   * `encrypted` is `false` (and every cipher field `null`) for legacy,
   * pre-Phase-1 files whose bytes and name are both plaintext. When
   * `true`, the file's content on disk/bucket is AES-256-GCM ciphertext,
   * `wrappedKeyCiphertext`/`wrappedKeyIv` hold the per-file content key
   * wrapped by the owning vault's DEK, and `name` is null — the file's
   * real name is only available as `encryptedName`/`nameIv`, encrypted
   * directly with the vault DEK. All of this is opaque to the server and
   * only decryptable/unwrappable client-side.
   */
  encrypted: boolean;
  /** Base64-encoded AES-256-GCM ciphertext of the per-file key, wrapped by the vault DEK. */
  wrappedKeyCiphertext: string | null;
  /** Base64-encoded 12-byte IV used for the vault-DEK wrap above. */
  wrappedKeyIv: string | null;
  /** Base64-encoded AES-256-GCM ciphertext of the file's name, encrypted directly with the vault DEK. */
  encryptedName: string | null;
  /** Base64-encoded 12-byte IV used for the name encryption above. */
  nameIv: string | null;
}
