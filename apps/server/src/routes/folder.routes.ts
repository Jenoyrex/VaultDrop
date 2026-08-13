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

  // Discriminated create payload: a legacy folder is created with a
  // plaintext `name`; a folder in an encrypted vault with a client-
  // encrypted `{ encryptedName, nameIv }` pair — never a plaintext name.
  const createFolderSchema = z.union([
    z.object({
      vaultId: z.string().uuid(),
      parentId: z.string().uuid().nullish(),
      name: z.string().min(1).max(120)
    }),
    z.object({
      vaultId: z.string().uuid(),
      parentId: z.string().uuid().nullish(),
      encryptedName: z.string().min(1),
      nameIv: z.string().min(1)
    })
  ]);

  // `name`/`encryptedName` are both optional so a parentId-only move (no
  // rename) keeps working; at most one of the two may be supplied, and
  // `encryptedName`/`nameIv` must be supplied together. Which one is
  // actually allowed for a given folder is enforced in FolderService
  // against that folder's own `encrypted` flag, not just by this schema.
  const updateFolderSchema = z
    .object({
      name: z.string().min(1).max(120).optional(),
      encryptedName: z.string().min(1).optional(),
      nameIv: z.string().min(1).optional(),
      parentId: z.string().uuid().nullable().optional()
    })
    .refine((data) => !(data.name !== undefined && data.encryptedName !== undefined), {
      message: "Provide either name or encryptedName, not both"
    })
    .refine((data) => (data.encryptedName === undefined) === (data.nameIv === undefined), {
      message: "encryptedName and nameIv must be provided together"
    });

  const contentsQuerySchema = z.object({
    vaultId: z.string().uuid(),
    folderId: z.string().uuid().optional()
  });

  // `query` is optional: omitting it requests the unfiltered subtree
  // (every folder/file in scope, ciphertext fields included as-is) for an
  // encrypted vault's client to decrypt and search locally, since the
  // server cannot match a query string against ciphertext. Legacy vaults
  // keep always supplying `query` and get the existing server-side
  // substring-matched behavior.
  const searchQuerySchema = z.object({
    vaultId: z.string().uuid(),
    folderId: z.string().uuid().optional(),
    query: z.string().min(1).optional()
  });

  router.use(requireAuth);

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();
      const body = createFolderSchema.parse(req.body);
      const folder = await folderService.createFolder(req.user.sub, {
        vaultId: body.vaultId,
        parentId: body.parentId ?? null,
        ...("name" in body
          ? { name: body.name }
          : { encryptedName: body.encryptedName, nameIv: body.nameIv })
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

  router.get(
    "/search",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();
      const query = searchQuerySchema.parse(req.query);
      const results = await folderService.searchContents(
        query.vaultId,
        req.user.sub,
        query.query ?? null,
        query.folderId ?? null
      );
      res.status(200).json(results);
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