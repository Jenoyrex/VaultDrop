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

export interface CreateVaultRequest {
  name: string;
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
