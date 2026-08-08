import express, { type Express } from "express";
import cors from "cors";
import type { PrismaClient } from "@prisma/client";
import type { ServerEnv } from "@vaultdrop/config";
import type { StorageAdapter } from "@vaultdrop/types";
import { createAuthRouter } from "./routes/auth.routes.js";
import { createVaultRouter } from "./routes/vault.routes.js";
import { createFolderRouter } from "./routes/folder.routes.js";
import { createFileRouter } from "./routes/file.routes.js";
import { createShareRouter } from "./routes/share.routes.js";
import { errorHandler } from "./middleware/error-handler.js";

export function createApp(prisma: PrismaClient, env: ServerEnv, storage: StorageAdapter): Express {
  const app = express();

  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/auth", createAuthRouter(prisma, env));
  app.use("/vaults", createVaultRouter(prisma, env));
  app.use("/folders", createFolderRouter(prisma, env));
  app.use("/files", createFileRouter(prisma, env, storage));
  app.use("/shares", createShareRouter(prisma, env, storage));

  app.use((req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
  });

  app.use(errorHandler);

  return app;
}