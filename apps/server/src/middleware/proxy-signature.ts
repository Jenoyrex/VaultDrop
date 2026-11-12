import type { NextFunction, Request, Response } from "express";
import type { ServerEnv } from "@vaultdrop/config";
import { isValidNetlifyProxySignature } from "@vaultdrop/crypto";
import { AppError } from "../utils/app-error.js";

/**
 * Only lets in requests that came through the Netlify /api proxy.
 *
 * Why: the Render URL is public. A client calling it directly skips one
 * proxy hop, so with TRUST_PROXY_HOPS set correctly for the Netlify path,
 * a direct caller could write the X-Forwarded-For entry Express treats as
 * the client IP and dodge every per-IP rate limit. Requiring Netlify's
 * signature closes that path.
 *
 * Enforced only when API_PROXY_SECRET is set (required in production by
 * the env schema; unset in local dev and tests). /health is exempt because
 * Render's health checks call the service directly.
 */
export function createProxySignatureCheck(env: ServerEnv) {
  const secret = env.API_PROXY_SECRET;

  return function proxySignatureCheck(req: Request, _res: Response, next: NextFunction): void {
    if (!secret || req.path === "/health") {
      next();
      return;
    }
    const signature = req.get("x-nf-sign");
    next(signature && isValidNetlifyProxySignature(signature, secret) ? undefined : AppError.proxySignatureRequired());
  };
}
