import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import type { PrismaClient } from "@prisma/client";
import type { ServerEnv } from "@vaultdrop/config";
import type { StorageAdapter } from "@vaultdrop/types";
import { createAuthRouter } from "./routes/auth.routes.js";
import { createVaultRouter } from "./routes/vault.routes.js";
import { createFolderRouter } from "./routes/folder.routes.js";
import { createFileRouter } from "./routes/file.routes.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";

export function createApp(prisma: PrismaClient, env: ServerEnv, storage: StorageAdapter): Express {
  const app = express();

  // Explicit, numeric hop count — never the blanket `true` value, which
  // would trust X-Forwarded-For from any client and which express-rate-limit
  // itself refuses to key on for exactly that reason. Defaults to 0 (no
  // proxy trusted), reproducing today's exact direct-connection behavior
  // unless an operator explicitly configures it for their real topology.
  app.set("trust proxy", env.TRUST_PROXY_HOPS ?? 0);

  // Mounted first so the access log's duration covers the full request,
  // including body parsing and everything downstream.
  app.use(requestLogger);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/auth", createAuthRouter(prisma, env));
  app.use("/vaults", createVaultRouter(prisma, env));
  app.use("/folders", createFolderRouter(prisma, env));
  app.use("/files", createFileRouter(prisma, env, storage));

  app.use((req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
  });

  app.use(errorHandler);

  return app;
}
