import type { NextFunction, Request, Response } from "express";
import { InvalidTokenError, verifyAccessToken } from "@vaultdrop/crypto";
import type { ServerEnv } from "@vaultdrop/config";
import { AppError } from "../utils/app-error.js";

export function createAuthMiddleware(env: ServerEnv) {
  return function requireAuth(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      next(AppError.invalidToken("Missing bearer token"));
      return;
    }
    const token = header.slice("Bearer ".length).trim();
    try {
      req.user = verifyAccessToken(token, env.JWT_SECRET);
      next();
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        next(AppError.invalidToken(error.message));
        return;
      }
      next(AppError.invalidToken());
    }
  };
}