import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { ServerEnv } from "@vaultdrop/config";
import type { StorageAdapter } from "@vaultdrop/types";
import { asyncHandler } from "../utils/async-handler.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { AppError } from "../utils/app-error.js";
import { ShareService } from "../services/share.service.js";

export function createShareRouter(
  prisma: PrismaClient,
  env: ServerEnv,
  storage: StorageAdapter
): Router {
  const router = Router();
  const shareService = new ShareService(prisma, storage);
  const requireAuth = createAuthMiddleware(env);

  const createShareSchema = z.object({
    fileId: z.string().uuid(),
    expiresIn: z.enum(["never", "24h", "7d", "30d"]),
    password: z.string().min(1).max(200).optional()
  });

  function getPasswordFromQuery(req: {
    query: Record<string, unknown>;
  }): string | undefined {
    const value = req.query["password"];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  // ✅ Only this route requires auth — a share is created by the file's
  // owner. Everything else here is a public, unauthenticated route since
  // share links are meant to be opened by people without an account.
  router.post(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();

      const body = createShareSchema.parse(req.body);

      const share = await shareService.createShare(req.user.sub, {
        fileId: body.fileId,
        expiresIn: body.expiresIn,
        password: body.password
      });

      res.status(201).json({ share });
    })
  );

  router.get(
    "/:token",
    asyncHandler(async (req, res) => {
      const password = getPasswordFromQuery(req);

      const metadata = await shareService.getShareMetadata(
        req.params["token"] as string,
        password
      );

      res.status(200).json(metadata);
    })
  );

  router.get(
    "/:token/download",
    asyncHandler(async (req, res) => {
      const password = getPasswordFromQuery(req);

      const { stream, file } = await shareService.getShareFileStream(
        req.params["token"] as string,
        password,
        "download"
      );

      res.setHeader("Content-Type", file.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(file.name)}"`
      );

      stream.pipe(res);
    })
  );

  router.get(
    "/:token/preview",
    asyncHandler(async (req, res) => {
      const password = getPasswordFromQuery(req);

      const { stream, file } = await shareService.getShareFileStream(
        req.params["token"] as string,
        password,
        "preview"
      );

      res.setHeader("Content-Type", file.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(file.name)}"`
      );

      stream.pipe(res);
    })
  );

  return router;
}