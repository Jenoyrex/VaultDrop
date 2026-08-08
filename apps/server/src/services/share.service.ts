import type { File as PrismaFile, PrismaClient } from "@prisma/client";
import type { StorageAdapter } from "@vaultdrop/types";
import { hashPassword, verifyPassword } from "@vaultdrop/crypto";
import { AppError } from "../utils/app-error.js";
import { VaultService } from "./vault.service.js";

const PREVIEWABLE_MIME_PREFIXES = ["image/", "text/", "audio/", "video/"];
const PREVIEWABLE_EXACT_MIME_TYPES = new Set([
  "application/pdf",
  "application/json"
]);

function isPreviewable(mimeType: string): boolean {
  return (
    PREVIEWABLE_EXACT_MIME_TYPES.has(mimeType) ||
    PREVIEWABLE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
  );
}

export type ShareExpiryOption = "never" | "24h" | "7d" | "30d";

export interface CreateShareInput {
  fileId: string;
  expiresIn: ShareExpiryOption;
  password?: string;
}

export interface ShareDTO {
  id: string;
  token: string;
  fileId: string;
  expiresAt: string | null;
  hasPassword: boolean;
  createdAt: string;
}

export interface ShareMetadataResponse {
  requiresPassword: boolean;
  expiresAt: string | null;
  file: {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
  } | null;
}

function expiryToDate(option: ShareExpiryOption): Date | null {
  const now = Date.now();

  switch (option) {
    case "24h":
      return new Date(now + 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now + 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now + 30 * 24 * 60 * 60 * 1000);
    case "never":
    default:
      return null;
  }
}

export class ShareService {
  private readonly vaultService: VaultService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageAdapter
  ) {
    this.vaultService = new VaultService(prisma);
  }

  private async getOwnedFileOrThrow(
    fileId: string,
    ownerId: string
  ): Promise<PrismaFile> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId }
    });

    if (!file) {
      throw AppError.notFound("File not found");
    }

    await this.vaultService.getOwnedVaultOrThrow(file.vaultId, ownerId);

    return file;
  }

  async createShare(
    ownerId: string,
    input: CreateShareInput
  ): Promise<ShareDTO> {
    await this.getOwnedFileOrThrow(input.fileId, ownerId);

    const passwordHash = input.password
      ? await hashPassword(input.password)
      : null;

    const expiresAt = expiryToDate(input.expiresIn);

    const share = await this.prisma.share.create({
      data: {
        fileId: input.fileId,
        expiresAt,
        passwordHash
      }
    });

    return {
      id: share.id,
      token: share.token,
      fileId: share.fileId,
      expiresAt: share.expiresAt ? share.expiresAt.toISOString() : null,
      hasPassword: !!share.passwordHash,
      createdAt: share.createdAt.toISOString()
    };
  }

  private async getValidShareOrThrow(token: string) {
    const share = await this.prisma.share.findUnique({
      where: { token },
      include: { file: true }
    });

    if (!share) {
      throw AppError.notFound("Share link not found");
    }

    if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
      throw new AppError(
        410,
        "SHARE_EXPIRED",
        "This share link has expired"
      );
    }

    return share;
  }

  async getShareMetadata(
    token: string,
    password?: string
  ): Promise<ShareMetadataResponse> {
    const share = await this.getValidShareOrThrow(token);

    const requiresPassword = !!share.passwordHash;
    const expiresAt = share.expiresAt ? share.expiresAt.toISOString() : null;

    if (requiresPassword) {
      if (!password) {
        return {
          requiresPassword: true,
          expiresAt,
          file: null
        };
      }

      const valid = await verifyPassword(share.passwordHash!, password);

      if (!valid) {
        throw AppError.unauthorized("Incorrect password");
      }
    }

    return {
      requiresPassword: false,
      expiresAt,
      file: {
        id: share.file.id,
        name: share.file.name,
        mimeType: share.file.mimeType,
        sizeBytes: share.file.sizeBytes,
        createdAt: share.file.createdAt.toISOString()
      }
    };
  }

  async getShareFileStream(
    token: string,
    password: string | undefined,
    mode: "download" | "preview"
  ): Promise<{ stream: NodeJS.ReadableStream; file: PrismaFile }> {
    const share = await this.getValidShareOrThrow(token);

    if (share.passwordHash) {
      if (!password) {
        throw AppError.unauthorized("Password required");
      }

      const valid = await verifyPassword(share.passwordHash, password);

      if (!valid) {
        throw AppError.unauthorized("Incorrect password");
      }
    }

    if (mode === "preview" && !isPreviewable(share.file.mimeType)) {
      throw new AppError(
        415,
        "UNSUPPORTED_PREVIEW",
        "This file type cannot be previewed inline"
      );
    }

    const stream = await this.storage.getStream(share.file.storageKey);

    return { stream, file: share.file };
  }
}