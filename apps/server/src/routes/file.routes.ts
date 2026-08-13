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

/**
 * The `filename` used in a `Content-Disposition` header. For a legacy
 * file this is its real (plaintext) name, exactly as before. For an
 * encrypted file, `file.name` is null by construction — falling back to
 * `file.id` (a random UUID, not derived from or related to the real
 * name) keeps the header well-formed without ever putting a plaintext
 * name on the wire here. The browser already knows the real, decrypted
 * name client-side and re-applies it when saving the downloaded blob
 * (see `saveBlob` in `apps/web/src/lib/download/decrypt-download.ts`),
 * so this header's filename is cosmetic for encrypted files, not load-bearing.
 */
function contentDispositionFilename(file: { name: string | null; id: string }): string {
  return file.name ?? file.id;
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
  // the wrapped (still-encrypted) per-file key and the encrypted name —
  // travels as query params instead of multipart fields. Deliberately no
  // `name` field here: the server must never receive this file's
  // plaintext name, not even transiently in a URL/query string that
  // could end up in an access log.
  const encryptedUploadQuerySchema = uploadQuerySchema.extend({
    encryptedName: z.string().min(1),
    nameIv: z.string().min(1),
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

  // Discriminated rename payload: a legacy file is renamed with a
  // plaintext `name`; an encrypted file is renamed with a client-encrypted
  // `{ encryptedName, nameIv }` pair — never a plaintext name. Which shape
  // is actually allowed for a given file is enforced in FileService against
  // that file's own `encrypted` flag, not just by this schema.
  const renameFileSchema = z.union([
    z.object({ name: z.string().min(1).max(255) }),
    z.object({
      encryptedName: z.string().min(1),
      nameIv: z.string().min(1)
    })
  ]);

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

      // No plaintext name to check for an encrypted upload — the server
      // never receives one (see assertCanUpload's doc comment).
      await fileService.assertCanUpload(
        req.user.sub,
        query.vaultId,
        query.folderId ?? null,
        null
      );

      // Deliberately omits the filename argument: an encrypted upload's
      // storage key must never embed the plaintext name (it would leak
      // into the filesystem path / cloud object key / any storage-layer
      // logging), unlike the legacy path below which still does.
      const storageKey = buildVaultStorageKey(
        query.vaultId,
        randomUUID()
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
        encryptedName: query.encryptedName,
        nameIv: query.nameIv,
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

      // Encrypted files: the stored bytes are ciphertext, decryptable only
      // client-side. Serve them as opaque application/octet-stream — never
      // label ciphertext with the file's real mime type — so the server
      // can never be the thing that presents ciphertext as plaintext.
      res.setHeader(
        "Content-Type",
        file.encrypted ? "application/octet-stream" : file.mimeType
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(
          contentDispositionFilename(file)
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

      // Same rule as /download: ciphertext is always opaque
      // application/octet-stream, and served as an attachment rather than
      // inline — it isn't safe to render, and the browser must decrypt it
      // client-side before ever treating the bytes as file.mimeType.
      if (file.encrypted) {
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(
            contentDispositionFilename(file)
          )}"`
        );
      } else {
        res.setHeader("Content-Type", file.mimeType);
        res.setHeader(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(
            contentDispositionFilename(file)
          )}"`
        );
      }

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
        body
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