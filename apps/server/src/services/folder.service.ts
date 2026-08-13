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
    updatedAt: folder.updatedAt.toISOString(),
    encrypted: folder.encrypted,
    encryptedName: folder.encryptedName,
    nameIv: folder.nameIv
  };
}

/** Discriminated create payload — a legacy folder is created with a plaintext `name`; an encrypted-vault folder with a client-encrypted `{ encryptedName, nameIv }` pair. */
export type CreateFolderInput =
  | { vaultId: string; parentId?: string | null; name: string }
  | { vaultId: string; parentId?: string | null; encryptedName: string; nameIv: string };

/** `name` and `encryptedName` are both optional so a parentId-only move (no rename) keeps working; at most one of the two may be supplied, enforced in `updateFolder`. */
export interface UpdateFolderInput {
  name?: string;
  encryptedName?: string;
  nameIv?: string;
  parentId?: string | null;
}

// ✅ NEW — types for the recursive search feature. Kept local to this
// service (mirroring the existing project convention of not touching the
// frozen @vaultdrop/types package) rather than adding to it.
//
// `name` is nullable and the cipher fields are included so a search
// result's `path` (breadcrumb chain) can be decrypted client-side for an
// encrypted vault, exactly like any other folder name.
export interface PathSegment {
  id: string;
  name: string | null;
  encrypted: boolean;
  encryptedName: string | null;
  nameIv: string | null;
}

export interface FolderSearchResult extends FolderDTO {
  path: PathSegment[];
}

export interface FileSearchResult {
  id: string;
  name: string | null;
  mimeType: string;
  sizeBytes: number;
  vaultId: string;
  folderId: string | null;
  storageProvider: string;
  storageKey: string;
  createdAt: string;
  updatedAt: string;
  encrypted: boolean;
  wrappedKeyCiphertext: string | null;
  wrappedKeyIv: string | null;
  encryptedName: string | null;
  nameIv: string | null;
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
    input: CreateFolderInput
  ): Promise<FolderDTO> {
    await this.vaultService.getOwnedVaultOrThrow(input.vaultId, ownerId);

    if (input.parentId) {
      await this.assertParentBelongsToVault(input.parentId, input.vaultId);
    }

    const isCiphertext = "encryptedName" in input;

    // Duplicate-name detection only applies to legacy plaintext folders.
    // For an encrypted folder the server never receives a plaintext name
    // to compare against, and two different plaintexts never produce
    // colliding ciphertext either — there is nothing meaningful to check
    // here. Duplicate detection for encrypted folders is client-side only.
    if (!isCiphertext) {
      const existing = await this.prisma.folder.findFirst({
        where: { vaultId: input.vaultId, parentId: input.parentId ?? null, name: input.name }
      });
      if (existing) {
        throw AppError.conflict("A folder with this name already exists here");
      }
    }

    const folder = await this.prisma.folder.create({
      data: isCiphertext
        ? {
            name: null,
            vaultId: input.vaultId,
            parentId: input.parentId ?? null,
            encrypted: true,
            encryptedName: input.encryptedName,
            nameIv: input.nameIv
          }
        : {
            name: input.name,
            vaultId: input.vaultId,
            parentId: input.parentId ?? null,
            encrypted: false,
            encryptedName: null,
            nameIv: null
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
        updatedAt: file.updatedAt.toISOString(),
        encrypted: file.encrypted,
        wrappedKeyCiphertext: file.wrappedKeyCiphertext,
        wrappedKeyIv: file.wrappedKeyIv,
        encryptedName: file.encryptedName,
        nameIv: file.nameIv
      }))
    };
  }

  // `input.name` and `input.encryptedName` must match the folder's own
  // `encrypted` flag when supplied — the same guard `FileService.renameFile`
  // applies — so a plaintext name can never land on an encrypted row (or a
  // ciphertext blob on a legacy one). Both may be omitted together for a
  // parentId-only move that doesn't rename the folder at all.
  async updateFolder(
    folderId: string,
    ownerId: string,
    input: UpdateFolderInput
  ): Promise<FolderDTO> {
    const folder = await this.getFolderOrThrow(folderId, ownerId);

    if (input.name !== undefined && folder.encrypted) {
      throw AppError.badRequest(
        "This folder's name is encrypted; rename it with an encrypted name"
      );
    }

    if (input.encryptedName !== undefined && !folder.encrypted) {
      throw AppError.badRequest(
        "This folder's name is not encrypted; rename it with a plaintext name"
      );
    }

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
        encryptedName: input.encryptedName ?? undefined,
        nameIv: input.nameIv ?? undefined,
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
  //
  // `query === null` is a distinct mode from "empty query": it returns
  // every folder/file in scope, unfiltered (ciphertext fields included as-
  // is), instead of running any name comparison. An encrypted vault's
  // client uses this once per folder navigation to fetch the subtree it
  // then decrypts and searches locally — the server is never asked to
  // match a query string against ciphertext, because it structurally
  // cannot: an encrypted row's `name` is null, and `matchesQuery` below
  // treats a null name as "never matches" whenever a real query is given.
  async searchContents(
    vaultId: string,
    ownerId: string,
    query: string | null,
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
        segments.unshift({
          id: current.id,
          name: current.name,
          encrypted: current.encrypted,
          encryptedName: current.encryptedName,
          nameIv: current.nameIv
        });
        current = current.parentId
          ? folderById.get(current.parentId) ?? null
          : null;
      }
      return segments;
    };

    const normalizedQuery = query !== null ? query.trim().toLowerCase() : null;

    // `name === null` means this row's real name is only known client-side
    // (it's encrypted) — the server has no way to compare it against a
    // query string, so it never matches a real query. When `normalizedQuery`
    // is null (subtree-fetch mode), everything in scope matches.
    const matchesQuery = (name: string | null): boolean => {
      if (normalizedQuery === null) return true;
      if (name === null) return false;
      return name.toLowerCase().includes(normalizedQuery);
    };

    const matchingFolders: FolderSearchResult[] = allFolders
      .filter((folder) => {
        const inScope = rootFolderId
          ? subtreeFolderIds.has(folder.id) && folder.id !== rootFolderId
          : subtreeFolderIds.has(folder.id);
        return inScope && matchesQuery(folder.name);
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
        return inScope && matchesQuery(file.name);
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
        encrypted: file.encrypted,
        wrappedKeyCiphertext: file.wrappedKeyCiphertext,
        wrappedKeyIv: file.wrappedKeyIv,
        encryptedName: file.encryptedName,
        nameIv: file.nameIv,
        path: pathOf(file.folderId)
      }));

    return {
      folders: matchingFolders,
      files: matchingFiles
    };
  }
}
