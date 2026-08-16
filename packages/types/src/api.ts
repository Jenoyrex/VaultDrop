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

/**
 * The vault's recovery-wrapped DEK ciphertext. Returned only from the
 * dedicated `GET /vaults/:id/recovery-key` endpoint — deliberately never
 * included in `VaultDTO` or any general vault response (see
 * `VaultDTO.hasRecoveryKey` for the safe yes/no signal used everywhere
 * else). Opaque to the server; only decryptable client-side with the
 * user's recovery key.
 */
export interface RecoveryEnvelopeResponse {
  recoveryWrappedDekCiphertext: string;
  recoveryWrappedDekIv: string;
}

/**
 * Body for enrolling or rotating a vault's recovery envelope
 * (`PUT /vaults/:id/recovery-key`). Generated entirely client-side by
 * wrapping the vault DEK with a freshly generated recovery key — the
 * server only ever receives this opaque ciphertext/IV pair, never the
 * recovery key or the DEK itself. Submitting this again for a vault that
 * already has one overwrites and permanently invalidates the previous
 * recovery envelope: only the recovery key that produced the newest
 * ciphertext can ever unwrap it.
 */
export type EnrollRecoveryKeyRequest = RecoveryEnvelopeResponse;

/**
 * One vault's new password-wrap envelope submitted as part of an account
 * password change (`PUT /auth/password`) — identical shape to
 * `VaultEncryptionEnvelope` plus the `vaultId` it belongs to, since a
 * password change submits many of these in one request. The server never
 * derives or interprets this material; it only accepts it after
 * independently verifying the account owns every currently-encrypted
 * vault it's expected to (see `ChangePasswordRequest`).
 */
export interface VaultPasswordRewrap extends VaultEncryptionEnvelope {
  vaultId: string;
}

/**
 * Body for `PUT /auth/password`. `currentPassword`/`newPassword` are sent
 * in cleartext for server-side Argon2 verification/hashing only — the
 * same trust boundary `/auth/login` already uses — and are never used
 * server-side to derive or touch any KEK/DEK. `vaults` must contain
 * exactly one rewrap entry for every vault this account currently has
 * encrypted (no more, no fewer, no duplicates) or the server rejects the
 * entire request before changing anything.
 */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  vaults: VaultPasswordRewrap[];
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
