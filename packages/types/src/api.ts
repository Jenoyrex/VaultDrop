import type { FileDTO, FolderDTO, UserDTO, VaultDTO } from "./entities.js";

/* ---------------------------------- Auth --------------------------------- */

export interface RegisterRequest {
  username: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  user: UserDTO;
  accessToken: string;
}

/* ---------------------------------- Vault --------------------------------- */

/**
 * Zero-knowledge encryption envelope for a vault, generated entirely
 * client-side at creation time (see `apps/web/src/lib/crypto`). Optional
 * on `CreateVaultRequest` so legacy, unencrypted vault creation keeps
 * working unchanged — omit every field for a legacy vault, or supply all
 * of them together to create an encrypted one. The server never sees the
 * plaintext password, the KEK, or the unwrapped DEK; it only stores the
 * ciphertext blobs the browser hands it.
 */
export interface VaultEncryptionEnvelope {
  encryptionVersion: number;
  kekSalt: string;
  kekIterations: number;
  kekHash: string;
  wrappedDekCiphertext: string;
  wrappedDekIv: string;
}

export interface CreateVaultRequest {
  name: string;
  encryption?: VaultEncryptionEnvelope;
}

/* --------------------------------- Folder --------------------------------- */

export interface CreateFolderRequest {
  name: string;
  vaultId: string;
  parentId?: string | null;
}

export interface UpdateFolderRequest {
  name?: string;
  parentId?: string | null;
}

/* ---------------------------------- File ---------------------------------- */

/**
 * Zero-knowledge encryption envelope for a single file's content key,
 * generated entirely client-side (see `apps/web/src/lib/upload`). The
 * per-file AES-256-GCM key is generated in the browser, used to encrypt
 * the file content, then wrapped by the caller's already-unwrapped vault
 * DEK — the server only ever receives this wrapped (ciphertext) form, via
 * query params on `POST /files/upload-encrypted`, never the raw key.
 */
export interface FileEncryptionEnvelope {
  encryptionVersion: number;
  wrappedKeyCiphertext: string;
  wrappedKeyIv: string;
}

export interface FileUploadMetadataResponse {
  file: FileDTO;
}

export interface FolderContentsResponse {
  folder: FolderDTO | null;
  subfolders: FolderDTO[];
  files: FileDTO[];
}

/* ------------------------------- Envelopes -------------------------------- */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResult<T> = T | ApiErrorBody;
