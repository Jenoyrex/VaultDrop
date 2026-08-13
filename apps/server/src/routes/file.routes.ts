import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { ServerEnv } from "@vaultdrop/config";
import type { StorageAdapter } from "@vaultdrop/types";
import { asyncHandler } from "../utils/async-handler.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { AppError } from "../utils/app-error.js";
import { FileService } from "../services/file.service.js";
import { StreamingMulterStorageEngine } from "../storage/streaming-multer-storage-engine.js";
import { buildVaultStorageKey } from "../storage/local-storage-adapter.js";

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

  const uploadQuerySchema = z.object({
    vaultId: z.string().uuid(),
    folderId: z.string().uuid().optional()
  });

  // Query contract for POST /upload-encrypted. The request body carries
  // ciphertext only, so everything that isn't file content — including
  // the wrapped (still-encrypted) per-file key — travels as query params
  // instead of multipart fields.
  const encryptedUploadQuerySchema = uploadQuerySchema.extend({
    name: z.string().min(1).max(255),
    mimeType: z.string().min(1),
    encryptionVersion: z.coerce.number().int().positive(),
    wrappedKeyCiphertext: z.string().min(1),
    wrappedKeyIv: z.string().min(1)
  });

  // Validates vaultId/folderId before multer starts parsing the
  // multipart body at all, so a malformed request 400s immediately
  // instead of failing deep inside the streaming upload path.
  function validateUploadQuery(
    req: Request,
    _res: Response,
    next: NextFunction
  ): void {
    try {
      uploadQuerySchema.parse(req.query);
      next();
    } catch (error) {
      next(error);
    }
  }

  const streamingStorageEngine = new StreamingMulterStorageEngine(
    storage,
    fileService,
    (req) => {
      if (!req.user) throw AppError.unauthorized();
      return req.user.sub;
    },
    (req) => {
      const query = uploadQuerySchema.parse(req.query);
      return { vaultId: query.vaultId, folderId: query.folderId ?? null };
    }
  );

  const upload = multer({
    storage: streamingStorageEngine,
    limits: {
      fileSize: env.MAX_UPLOAD_BYTES
    }
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
    validateUploadQuery,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();

      const query = uploadQuerySchema.parse(req.query);

      if (!req.file) {
        throw AppError.badRequest(
          "No file was provided under the 'file' field"
        );
      }

      const file = await fileService.finalizeUpload({
        vaultId: query.vaultId,
        folderId: query.folderId ?? null,
        originalName: req.file.originalname,
        mimeType:
          req.file.mimetype ||
          "application/octet-stream",
        storageKey: req.file.path,
        sizeBytes: req.file.size
      });

      res.status(201).json({ file });
    })
  );

  // ✅ UPLOAD (ENCRYPTED) — the request body is the raw ciphertext stream
  // produced client-side (a 12-byte nonce followed by framed AES-256-GCM
  // chunks); there is no multipart envelope, so multer isn't used here.
  // The body is piped straight into `storage.putStream`, mirroring what
  // `StreamingMulterStorageEngine` does for the legacy path, just without
  // a multipart part to read it from.
  router.post(
    "/upload-encrypted",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();

      const query = encryptedUploadQuerySchema.parse(req.query);

      await fileService.assertCanUpload(
        req.user.sub,
        query.vaultId,
        query.folderId ?? null,
        query.name
      );

      const storageKey = buildVaultStorageKey(
        query.vaultId,
        randomUUID(),
        query.name
      );

      // multer's `limits.fileSize` enforces MAX_UPLOAD_BYTES on the legacy
      // path; this route bypasses multer entirely, so the same ceiling is
      // enforced here on the raw request stream before it reaches storage.
      let bytesSeen = 0;
      const enforceMaxSize = new Transform({
        transform(
          chunk: Buffer,
          _encoding: BufferEncoding,
          callback: (error?: Error | null, data?: Buffer) => void
        ) {
          bytesSeen += chunk.length;
          if (bytesSeen > env.MAX_UPLOAD_BYTES) {
            callback(AppError.badRequest("File exceeds the maximum upload size"));
            return;
          }
          callback(null, chunk);
        }
      });

      let sizeBytes: number;

      try {
        const meta = await storage.putStream(
          storageKey,
          req.pipe(enforceMaxSize),
          query.mimeType
        );
        sizeBytes = meta.sizeBytes;
      } catch (error) {
        await storage.delete(storageKey).catch(() => undefined);
        throw error;
      }

      const file = await fileService.finalizeUpload({
        vaultId: query.vaultId,
        folderId: query.folderId ?? null,
        originalName: query.name,
        mimeType: query.mimeType,
        storageKey,
        sizeBytes,
        encrypted: true,
        wrappedKeyCiphertext: query.wrappedKeyCiphertext,
        wrappedKeyIv: query.wrappedKeyIv
      });

      res.status(201).json({ file });
    })
  );

  router.get(
    "/:fileId",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();

      const file =
        await fileService.getFileMetadata(
          req.params["fileId"] as string,
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
          req.params["fileId"] as string,
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
          req.params["fileId"] as string,
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
        req.params["fileId"] as string,
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
        req.params["fileId"] as string,
        req.user.sub
      );

      res.status(204).send();
    })
  );

  return router;
}