import { z } from "zod";
import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { ServerEnv } from "@vaultdrop/config";
import { asyncHandler } from "../utils/async-handler.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { AppError } from "../utils/app-error.js";
import { AuthService } from "../services/auth.service.js";
import { loginSchema, registerSchema } from "./auth.schemas.js";
import { createAuthRateLimiters } from "../middleware/rate-limit.js";

export function createAuthRouter(prisma: PrismaClient, env: ServerEnv): Router {
  const router = Router();
  const authService = new AuthService(prisma, env);
  const requireAuth = createAuthMiddleware(env);
  const usernameQuerySchema = z.object({ username: z.string().min(1).max(32) });
  const { credentialLimiter, enumerationLimiter } = createAuthRateLimiters(env);

  router.post(
    "/register",
    credentialLimiter,
    asyncHandler(async (req, res) => {
      const body = registerSchema.parse(req.body);
      const result = await authService.register(body.username, body.password);
      res.status(201).json(result);
    })
  );

  router.get(
    "/check-username",
    enumerationLimiter,
    asyncHandler(async (req, res) => {
      const username = usernameQuerySchema.parse(req.query).username;
      const exists = await authService.usernameExists(username);
      res.status(200).json({ exists });
    })
  );

  router.post(
    "/login",
    credentialLimiter,
    asyncHandler(async (req, res) => {
      const body = loginSchema.parse(req.body);
      const result = await authService.login(body.username, body.password);
      res.status(200).json(result);
    })
  );

  // JWTs are stateless, so logout is a client-side token discard. The server
  // still exposes this endpoint so the web app has a single, consistent
  // call site and so a future token-blocklist can slot in without changing
  // the client contract.
  router.post("/logout", requireAuth, (_req, res) => {
    res.status(204).send();
  });

  router.get(
    "/me",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) {
        throw AppError.unauthorized();
      }
      const user = await authService.getCurrentUser(req.user.sub);
      res.status(200).json({ user });
    })
  );

  return router;
}
