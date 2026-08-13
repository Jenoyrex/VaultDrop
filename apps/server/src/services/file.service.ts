import type { File as PrismaFile, PrismaClient } from "@prisma/client";
import type { StorageAdapter } from "@vaultdrop/types";
import type { FileDTO } from "@vaultdrop/types";
import { AppError } from "../utils/app-error.js";
import { VaultService } from "./vault.service.js";
import { FolderService } from "./folder.service.js";

function toFileDTO(file: PrismaFile): FileDTO {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    vaultId: file.vaultId,
    folderId: file.folderId,
    storageProvider: file.storageProvider,
    storageKey: file.storageKey,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    encrypted: file.encrypted,
    wrappedKeyCiphertext: file.wrappedKeyCiphertext,
    wrappedKeyIv: file.wrappedKeyIv,
    encryptedName: file.encryptedName,
    nameIv: file.nameIv
  };
}

/**
 * Legacy plaintext upload via `POST /files/upload` — `originalName` is
 * stored as-is in `File.name`, and every cipher field stays null.
 */
export interface PlaintextFinalizeUploadInput {
  encrypted?: false;
  vaultId: string;
  folderId: string | null;
  originalName: string;
  mimeType: string;
  storageKey: string;
  sizeBytes: number;
}

/**
 * Zero-knowledge upload via `POST /files/upload-encrypted` — the server
 * never receives (and therefore never stores, logs, or echoes back) a
 * plaintext name. `encryptedName`/`nameIv` are the client-encrypted name
 * (AES-256-GCM under the vault DEK); `wrappedKeyCiphertext`/`wrappedKeyIv`
 * are the client-wrapped per-file content key. `File.name` stays null.
 */
export interface EncryptedFinalizeUploadInput {
  encrypted: true;
  vaultId: string;
  folderId: string | null;
  encryptedName: string;
  nameIv: string;
  mimeType: string;
  storageKey: string;
  sizeBytes: number;
  wrappedKeyCiphertext: string;
  wrappedKeyIv: string;
}

export type FinalizeUploadInput =
  | PlaintextFinalizeUploadInput
  | EncryptedFinalizeUploadInput;

/** Discriminated rename payload — must match the target row's own `encrypted` flag. */
export type RenameFileInput =
  | { name: string }
  | { encryptedName: string; nameIv: string };

export class FileService {
  private readonly vaultService: VaultService;
  private readonly folderService: FolderService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageAdapter,
    private readonly storageDriverLabel: "LOCAL" | "CLOUD"
  ) {
    this.vaultService = new VaultService(prisma);
    this.folderService = new FolderService(prisma);
  }

  /**
   * Validates that `ownerId` may upload into `folderId` (or the vault
   * root) of `vaultId` — vault ownership, folder ownership/vault match,
   * and (for a legacy plaintext upload) a duplicate-name conflict. Called
   * by the streaming storage engine *before* any bytes are streamed, so
   * an invalid upload is rejected without ever touching storage.
   *
   * `originalName` is `null` for an encrypted upload — the server never
   * receives that file's plaintext name, so there is nothing to compare
   * against `File.name` for a duplicate-name check. Two different
   * plaintext names never produce colliding ciphertext either, so there
   * is no meaningful ciphertext-based check to run in its place;
   * duplicate-name detection for encrypted files is client-side only
   * (the browser already holds the folder's decrypted listing).
   */
  async assertCanUpload(
    ownerId: string,
    vaultId: string,
    folderId: string | null,
    originalName: string | null
  ): Promise<void> {
    await this.vaultService.getOwnedVaultOrThrow(vaultId, ownerId);

    if (folderId) {
      const folder = await this.folderService.getFolderOrThrow(
        folderId,
        ownerId
      );

      if (folder.vaultId !== vaultId) {
        throw AppError.badRequest("Folder does not belong to this vault");
      }
    }

    if (originalName === null) {
      return;
    }

    const existing = await this.prisma.file.findFirst({
      where: {
        vaultId,
        folderId,
        name: originalName
      }
    });

    if (existing) {
      throw AppError.conflict("A file with this name already exists here");
    }
  }

  /**
   * Records a file whose bytes have *already* been streamed to storage
   * (by the streaming storage engine, after `assertCanUpload` passed).
   * A single `create` call — no placeholder storageKey, no follow-up
   * update, since everything needed is already known by this point.
   */
  async finalizeUpload(input: FinalizeUploadInput): Promise<FileDTO> {
    const file = await this.prisma.file.create({
      data: input.encrypted
        ? {
            name: null,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            vaultId: input.vaultId,
            folderId: input.folderId,
            storageProvider: this.storageDriverLabel,
            storageKey: input.storageKey,
            encrypted: true,
            wrappedKeyCiphertext: input.wrappedKeyCiphertext,
            wrappedKeyIv: input.wrappedKeyIv,
            encryptedName: input.encryptedName,
            nameIv: input.nameIv
          }
        : {
            name: input.originalName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            vaultId: input.vaultId,
            folderId: input.folderId,
            storageProvider: this.storageDriverLabel,
            storageKey: input.storageKey,
            encrypted: false,
            wrappedKeyCiphertext: null,
            wrappedKeyIv: null,
            encryptedName: null,
            nameIv: null
          }
    });

    return toFileDTO(file);
  }

  async getFileOrThrow(
    fileId: string,
    ownerId: string
  ): Promise<PrismaFile> {
    const file = await this.prisma.file.findUnique({
      where: {
        id: fileId
      }
    });

    if (!file) {
      throw AppError.notFound("File not found");
    }

    await this.vaultService.getOwnedVaultOrThrow(
      file.vaultId,
      ownerId
    );

    return file;
  }

  async getFileMetadata(
    fileId: string,
    ownerId: string
  ): Promise<FileDTO> {
    const file = await this.getFileOrThrow(fileId, ownerId);
    return toFileDTO(file);
  }

  // ✅ NEW
  async listFiles(
    vaultId: string,
    ownerId: string
  ): Promise<FileDTO[]> {
    await this.vaultService.getOwnedVaultOrThrow(
      vaultId,
      ownerId
    );

    const files = await this.prisma.file.findMany({
      where: {
        vaultId
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return files.map(toFileDTO);
  }

  async getFileStream(
    fileId: string,
    ownerId: string
  ): Promise<{
    stream: NodeJS.ReadableStream;
    file: FileDTO;
  }> {
    const file = await this.getFileOrThrow(fileId, ownerId);

    const stream = await this.storage.getStream(file.storageKey);

    return {
      stream,
      file: toFileDTO(file)
    };
  }

  async deleteFile(
    fileId: string,
    ownerId: string
  ): Promise<void> {
    const file = await this.getFileOrThrow(fileId, ownerId);

    await this.storage.delete(file.storageKey);

    await this.prisma.file.delete({
      where: {
        id: file.id
      }
    });
  }

  // ✅ NEW — minimal additive method for the file rename feature.
  // Only updates the DB-stored display name; storageKey (the on-disk /
  // on-bucket path) is intentionally left untouched, so no storage move
  // is required.
  //
  // `input` must match the file's own `encrypted` flag: a plaintext
  // `{ name }` payload is only accepted for a legacy file, and a
  // ciphertext `{ encryptedName, nameIv }` payload only for an encrypted
  // one. This is the guard that stops a plaintext name from ever being
  // written into an encrypted row (or vice versa) — the server rejects
  // the mismatched shape outright rather than silently accepting it.
  async renameFile(
    fileId: string,
    ownerId: string,
    input: RenameFileInput
  ): Promise<FileDTO> {
    const file = await this.getFileOrThrow(fileId, ownerId);
    const isCiphertextRename = "encryptedName" in input;

    if (file.encrypted !== isCiphertextRename) {
      throw AppError.badRequest(
        file.encrypted
          ? "This file's name is encrypted; rename it with an encrypted name"
          : "This file's name is not encrypted; rename it with a plaintext name"
      );
    }

    if (!isCiphertextRename) {
      if (input.name === file.name) {
        return toFileDTO(file);
      }

      const existing = await this.prisma.file.findFirst({
        where: {
          vaultId: file.vaultId,
          folderId: file.folderId,
          name: input.name,
          NOT: {
            id: file.id
          }
        }
      });

      if (existing) {
        throw AppError.conflict(
          "A file with this name already exists here"
        );
      }

      const updated = await this.prisma.file.update({
        where: {
          id: file.id
        },
        data: {
          name: input.name
        }
      });

      return toFileDTO(updated);
    }

    // Encrypted rename: the server cannot compare ciphertext for
    // duplicates (see `assertCanUpload`) — that check is client-side only.
    const updated = await this.prisma.file.update({
      where: {
        id: file.id
      },
      data: {
        encryptedName: input.encryptedName,
        nameIv: input.nameIv
      }
    });

    return toFileDTO(updated);
  }
}