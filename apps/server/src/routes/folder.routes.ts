import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { ServerEnv } from "@vaultdrop/config";
import { asyncHandler } from "../utils/async-handler.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { AppError } from "../utils/app-error.js";
import { FolderService } from "../services/folder.service.js";

export function createFolderRouter(prisma: PrismaClient, env: ServerEnv): Router {
  const router = Router();
  const folderService = new FolderService(prisma);
  const requireAuth = createAuthMiddleware(env);

  const createFolderSchema = z.object({
    name: z.string().min(1).max(120),
    vaultId: z.string().uuid(),
    parentId: z.string().uuid().nullish()
  });

  const updateFolderSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    parentId: z.string().uuid().nullable().optional()
  });

  const contentsQuerySchema = z.object({
    vaultId: z.string().uuid(),
    folderId: z.string().uuid().optional()
  });

  router.use(requireAuth);

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();
      const body = createFolderSchema.parse(req.body);
      const folder = await folderService.createFolder(req.user.sub, {
        vaultId: body.vaultId,
        name: body.name,
        parentId: body.parentId ?? null
      });
      res.status(201).json({ folder });
    })
  );

  router.get(
    "/contents",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();
      const query = contentsQuerySchema.parse(req.query);
      const contents = await folderService.getFolderContents(
        query.vaultId,
        query.folderId ?? null,
        req.user.sub
      );
      res.status(200).json(contents);
    })
  );

  router.patch(
    "/:folderId",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();
      const body = updateFolderSchema.parse(req.body);
      const folder = await folderService.updateFolder(
        req.params["folderId"] as string,
        req.user.sub,
        body
      );
      res.status(200).json({ folder });
    })
  );

  router.delete(
    "/:folderId",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();
      await folderService.deleteFolder(req.params["folderId"] as string, req.user.sub);
      res.status(204).send();
    })
  );

  return router;
}
