import type { File as PrismaFile, PrismaClient } from "@prisma/client";
import type { StorageAdapter } from "@vaultdrop/types";
import type { FileDTO } from "@vaultdrop/types";
import { AppError } from "../utils/app-error.js";
import { VaultService } from "./vault.service.js";
import { FolderService } from "./folder.service.js";
import { buildVaultStorageKey } from "../storage/local-storage-adapter.js";

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
    updatedAt: file.updatedAt.toISOString()
  };
}

export interface UploadFileInput {
  vaultId: string;
  folderId: string | null;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

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

  async uploadFile(ownerId: string, input: UploadFileInput): Promise<FileDTO> {
    await this.vaultService.getOwnedVaultOrThrow(input.vaultId, ownerId);

    if (input.folderId) {
      const folder = await this.folderService.getFolderOrThrow(
        input.folderId,
        ownerId
      );

      if (folder.vaultId !== input.vaultId) {
        throw AppError.badRequest("Folder does not belong to this vault");
      }
    }

    const existing = await this.prisma.file.findFirst({
      where: {
        vaultId: input.vaultId,
        folderId: input.folderId,
        name: input.originalName
      }
    });

    if (existing) {
      throw AppError.conflict("A file with this name already exists here");
    }

    const file = await this.prisma.file.create({
      data: {
        name: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.byteLength,
        vaultId: input.vaultId,
        folderId: input.folderId,
        storageProvider: this.storageDriverLabel,
        storageKey: "pending"
      }
    });

    const storageKey = buildVaultStorageKey(
      input.vaultId,
      file.id,
      input.originalName
    );

    try {
      await this.storage.put({
        key: storageKey,
        data: input.buffer,
        contentType: input.mimeType
      });
    } catch (error) {
      await this.prisma.file
        .delete({
          where: {
            id: file.id
          }
        })
        .catch(() => undefined);

      throw error;
    }

    const updated = await this.prisma.file.update({
      where: {
        id: file.id
      },
      data: {
        storageKey
      }
    });

    return toFileDTO(updated);
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
  async renameFile(
    fileId: string,
    ownerId: string,
    newName: string
  ): Promise<FileDTO> {
    const file = await this.getFileOrThrow(fileId, ownerId);

    if (newName === file.name) {
      return toFileDTO(file);
    }

    const existing = await this.prisma.file.findFirst({
      where: {
        vaultId: file.vaultId,
        folderId: file.folderId,
        name: newName,
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
        name: newName
      }
    });

    return toFileDTO(updated);
  }
}