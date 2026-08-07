import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { ServerEnv } from "@vaultdrop/config";
import type { StorageAdapter } from "@vaultdrop/types";
import { asyncHandler } from "../utils/async-handler.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { AppError } from "../utils/app-error.js";
import { FileService } from "../services/file.service.js";

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

export function createFileRouter(
  prisma: PrismaClient,
  env: ServerEnv,
  storage: StorageAdapter
): Router {
  const router = Router();

  const storageDriverLabel =
    env.STORAGE_DRIVER === "cloud"
      ? "CLOUD"
      : "LOCAL";

  const fileService = new FileService(
    prisma,
    storage,
    storageDriverLabel
  );

  const requireAuth = createAuthMiddleware(env);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: env.MAX_UPLOAD_BYTES
    }
  });

  const uploadQuerySchema = z.object({
    vaultId: z.string().uuid(),
    folderId: z.string().uuid().optional()
  });

  const renameFileSchema = z.object({
    name: z.string().min(1).max(255)
  });

  router.use(requireAuth);

  // ✅ LIST FILES
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();

      const vaultId = req.query.vaultId as string;

      if (!vaultId) {
        throw AppError.badRequest("vaultId is required");
      }

      const files = await fileService.listFiles(
        vaultId,
        req.user.sub
      );

      res.json({ files });
    })
  );

  // ✅ UPLOAD
  router.post(
    "/upload",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();

      const query = uploadQuerySchema.parse(req.query);

      if (!req.file) {
        throw AppError.badRequest(
          "No file was provided under the 'file' field"
        );
      }

      const file = await fileService.uploadFile(
        req.user.sub,
        {
          vaultId: query.vaultId,
          folderId: query.folderId ?? null,
          originalName: req.file.originalname,
          mimeType:
            req.file.mimetype ||
            "application/octet-stream",
          buffer: req.file.buffer
        }
      );

      res.status(201).json({ file });
    })
  );

  router.get(
    "/:fileId",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();

      const file =
        await fileService.getFileMetadata(
          req.params.fileId,
          req.user.sub
        );

      res.json({ file });
    })
  );

  router.get(
    "/:fileId/download",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();

      const { stream, file } =
        await fileService.getFileStream(
          req.params.fileId,
          req.user.sub
        );

      res.setHeader(
        "Content-Type",
        file.mimeType
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(
          file.name
        )}"`
      );

      stream.pipe(res);
    })
  );

  router.get(
    "/:fileId/preview",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();

      const { stream, file } =
        await fileService.getFileStream(
          req.params.fileId,
          req.user.sub
        );

      if (!isPreviewable(file.mimeType)) {
        throw new AppError(
          415,
          "UNSUPPORTED_PREVIEW",
          "This file type cannot be previewed inline"
        );
      }

      res.setHeader(
        "Content-Type",
        file.mimeType
      );

      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(
          file.name
        )}"`
      );

      stream.pipe(res);
    })
  );

  router.patch(
    "/:fileId",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();

      const body = renameFileSchema.parse(req.body);

      const file = await fileService.renameFile(
        req.params.fileId,
        req.user.sub,
        body.name
      );

      res.status(200).json({ file });
    })
  );

  router.delete(
    "/:fileId",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();

      await fileService.deleteFile(
        req.params.fileId,
        req.user.sub
      );

      res.status(204).send();
    })
  );

  return router;
}