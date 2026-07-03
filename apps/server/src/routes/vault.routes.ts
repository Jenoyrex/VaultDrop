import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { ServerEnv } from "@vaultdrop/config";
import { asyncHandler } from "../utils/async-handler.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { AppError } from "../utils/app-error.js";
import { VaultService } from "../services/vault.service.js";

export function createVaultRouter(prisma: PrismaClient, env: ServerEnv): Router {
  const router = Router();
  const vaultService = new VaultService(prisma);
  const requireAuth = createAuthMiddleware(env);

  const createVaultSchema = z.object({
    name: z.string().min(1, "Vault name is required").max(120)
  });

  router.use(requireAuth);

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();
      const body = createVaultSchema.parse(req.body);
      const vault = await vaultService.createVault(req.user.sub, body.name);
      res.status(201).json({ vault });
    })
  );

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();
      const vaults = await vaultService.listVaults(req.user.sub);
      res.status(200).json({ vaults });
    })
  );

  router.get(
    "/:vaultId",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();
      const vault = await vaultService.getVault(req.params["vaultId"] as string, req.user.sub);
      res.status(200).json({ vault });
    })
  );

  router.delete(
    "/:vaultId",
    asyncHandler(async (req, res) => {
      if (!req.user) throw AppError.unauthorized();
      await vaultService.deleteVault(req.params["vaultId"] as string, req.user.sub);
      res.status(204).send();
    })
  );

  return router;
}
