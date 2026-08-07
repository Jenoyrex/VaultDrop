import type { File as PrismaFile, Folder, PrismaClient } from "@prisma/client";
import type { FolderContentsResponse, FolderDTO } from "@vaultdrop/types";
import { AppError } from "../utils/app-error.js";
import { VaultService } from "./vault.service.js";

function toFolderDTO(folder: Folder): FolderDTO {
  return {
    id: folder.id,
    name: folder.name,
    vaultId: folder.vaultId,
    parentId: folder.parentId,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString()
  };
}

// ✅ NEW — types for the recursive search feature. Kept local to this
// service (mirroring the existing project convention of not touching the
// frozen @vaultdrop/types package) rather than adding to it.
export interface PathSegment {
  id: string;
  name: string;
}

export interface FolderSearchResult extends FolderDTO {
  path: PathSegment[];
}

export interface FileSearchResult {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  vaultId: string;
  folderId: string | null;
  storageProvider: string;
  storageKey: string;
  createdAt: string;
  updatedAt: string;
  path: PathSegment[];
}

export interface SearchResponse {
  folders: FolderSearchResult[];
  files: FileSearchResult[];
}

export class FolderService {
  private readonly vaultService: VaultService;

  constructor(private readonly prisma: PrismaClient) {
    this.vaultService = new VaultService(prisma);
  }

  private async assertParentBelongsToVault(parentId: string, vaultId: string): Promise<void> {
    const parent = await this.prisma.folder.findUnique({ where: { id: parentId } });
    if (!parent || parent.vaultId !== vaultId) {
      throw AppError.badRequest("Parent folder does not exist in this vault");
    }
  }

  async createFolder(
    ownerId: string,
    input: { vaultId: string; name: string; parentId?: string | null }
  ): Promise<FolderDTO> {
    await this.vaultService.getOwnedVaultOrThrow(input.vaultId, ownerId);

    if (input.parentId) {
      await this.assertParentBelongsToVault(input.parentId, input.vaultId);
    }

    const existing = await this.prisma.folder.findFirst({
      where: { vaultId: input.vaultId, parentId: input.parentId ?? null, name: input.name }
    });
    if (existing) {
      throw AppError.conflict("A folder with this name already exists here");
    }

    const folder = await this.prisma.folder.create({
      data: {
        name: input.name,
        vaultId: input.vaultId,
        parentId: input.parentId ?? null
      }
    });
    return toFolderDTO(folder);
  }

  async getFolderOrThrow(folderId: string, ownerId: string): Promise<Folder> {
    const folder = await this.prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder) {
      throw AppError.notFound("Folder not found");
    }
    await this.vaultService.getOwnedVaultOrThrow(folder.vaultId, ownerId);
    return folder;
  }

  async getFolderContents(
    vaultId: string,
    folderId: string | null,
    ownerId: string
  ): Promise<FolderContentsResponse> {
    await this.vaultService.getOwnedVaultOrThrow(vaultId, ownerId);

    let folder: Folder | null = null;
    if (folderId) {
      folder = await this.getFolderOrThrow(folderId, ownerId);
      if (folder.vaultId !== vaultId) {
        throw AppError.badRequest("Folder does not belong to this vault");
      }
    }

    const [subfolders, files] = await Promise.all([
      this.prisma.folder.findMany({
        where: { vaultId, parentId: folderId },
        orderBy: { name: "asc" }
      }),
      this.prisma.file.findMany({
        where: { vaultId, folderId },
        orderBy: { name: "asc" }
      })
    ]);

    return {
      folder: folder ? toFolderDTO(folder) : null,
      subfolders: subfolders.map(toFolderDTO),
      files: files.map((file: PrismaFile) => ({
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
      }))
    };
  }

  async updateFolder(
    folderId: string,
    ownerId: string,
    input: { name?: string; parentId?: string | null }
  ): Promise<FolderDTO> {
    const folder = await this.getFolderOrThrow(folderId, ownerId);

    if (input.parentId !== undefined && input.parentId !== null) {
      if (input.parentId === folderId) {
        throw AppError.badRequest("A folder cannot be its own parent");
      }
      await this.assertParentBelongsToVault(input.parentId, folder.vaultId);
    }

    const updated = await this.prisma.folder.update({
      where: { id: folderId },
      data: {
        name: input.name ?? undefined,
        parentId: input.parentId === undefined ? undefined : input.parentId
      }
    });
    return toFolderDTO(updated);
  }

  async deleteFolder(folderId: string, ownerId: string): Promise<void> {
    await this.getFolderOrThrow(folderId, ownerId);
    await this.prisma.folder.delete({ where: { id: folderId } });
  }

  // ✅ NEW — minimal additive method for recursive search. The Folder
  // table is a plain adjacency list (parentId only, no materialized
  // path), so recursion is done in application code over the vault's
  // full folder list rather than via a schema change or recursive SQL.
  // At vault root (rootFolderId === null) the whole vault is searched;
  // inside a folder, only that folder's descendants are searched.
  async searchContents(
    vaultId: string,
    ownerId: string,
    query: string,
    rootFolderId: string | null
  ): Promise<SearchResponse> {
    await this.vaultService.getOwnedVaultOrThrow(vaultId, ownerId);

    if (rootFolderId) {
      const rootFolder = await this.getFolderOrThrow(rootFolderId, ownerId);
      if (rootFolder.vaultId !== vaultId) {
        throw AppError.badRequest("Folder does not belong to this vault");
      }
    }

    const [allFolders, allFiles] = await Promise.all([
      this.prisma.folder.findMany({ where: { vaultId } }),
      this.prisma.file.findMany({ where: { vaultId } })
    ]);

    const folderById = new Map<string, Folder>();
    for (const folder of allFolders) {
      folderById.set(folder.id, folder);
    }

    const childrenByParent = new Map<string | null, Folder[]>();
    for (const folder of allFolders) {
      const key = folder.parentId;
      const list = childrenByParent.get(key) ?? [];
      list.push(folder);
      childrenByParent.set(key, list);
    }

    // Every folder id reachable from rootFolderId (its descendants), plus
    // rootFolderId itself when set — so files placed directly inside the
    // root folder are also considered "in scope".
    const subtreeFolderIds = new Set<string>();

    const collectDescendants = (parentId: string | null): void => {
      const children = childrenByParent.get(parentId) ?? [];
      for (const child of children) {
        subtreeFolderIds.add(child.id);
        collectDescendants(child.id);
      }
    };

    if (rootFolderId) {
      subtreeFolderIds.add(rootFolderId);
    }
    collectDescendants(rootFolderId);

    const pathOf = (folderId: string | null): PathSegment[] => {
      const segments: PathSegment[] = [];
      let current = folderId ? folderById.get(folderId) ?? null : null;
      while (current) {
        segments.unshift({ id: current.id, name: current.name });
        current = current.parentId
          ? folderById.get(current.parentId) ?? null
          : null;
      }
      return segments;
    };

    const normalizedQuery = query.trim().toLowerCase();

    const matchingFolders: FolderSearchResult[] = allFolders
      .filter((folder) => {
        const inScope = rootFolderId
          ? subtreeFolderIds.has(folder.id) && folder.id !== rootFolderId
          : subtreeFolderIds.has(folder.id);
        return (
          inScope && folder.name.toLowerCase().includes(normalizedQuery)
        );
      })
      .map((folder) => ({
        ...toFolderDTO(folder),
        path: pathOf(folder.parentId)
      }));

    const matchingFiles: FileSearchResult[] = allFiles
      .filter((file) => {
        const inScope = rootFolderId
          ? file.folderId !== null && subtreeFolderIds.has(file.folderId)
          : file.folderId === null || subtreeFolderIds.has(file.folderId);
        return inScope && file.name.toLowerCase().includes(normalizedQuery);
      })
      .map((file) => ({
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
        path: pathOf(file.folderId)
      }));

    return {
      folders: matchingFolders,
      files: matchingFiles
    };
  }
}