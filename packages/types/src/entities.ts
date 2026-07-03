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
}
