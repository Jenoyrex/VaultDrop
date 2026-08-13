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
  name: string;
  vaultId: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StorageProvider = "LOCAL" | "CLOUD";

export interface FileDTO {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  vaultId: string;
  folderId: string | null;
  storageProvider: StorageProvider;
  storageKey: string;
  createdAt: string;
  updatedAt: string;

  /**
   * Zero-knowledge file content encryption metadata. `encrypted` is
   * `false` (and the wrap fields `null`) for legacy, pre-Phase-1 files
   * whose bytes are stored as plaintext. When `true`, the file's content
   * on disk/bucket is AES-256-GCM ciphertext, and `wrappedKeyCiphertext`/
   * `wrappedKeyIv` hold the per-file content key wrapped by the owning
   * vault's DEK — opaque to the server, only unwrappable client-side.
   */
  encrypted: boolean;
  /** Base64-encoded AES-256-GCM ciphertext of the per-file key, wrapped by the vault DEK. */
  wrappedKeyCiphertext: string | null;
  /** Base64-encoded 12-byte IV used for the vault-DEK wrap above. */
  wrappedKeyIv: string | null;
}
