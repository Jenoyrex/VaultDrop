import type { NextFunction, Request, Response } from "express";
import type { ServerEnv } from "@vaultdrop/config";
import { AppError } from "../utils/app-error.js";
import { readSessionCookie } from "./auth.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return "invalid";
  }
}

/**
 * CSRF defense in depth. The primary defense is the session cookie's
 * SameSite=Lax, which keeps browsers from attaching it to cross-site
 * POST/PUT/PATCH/DELETE requests. This check also rejects any
 * state-changing request whose Origin (or Referer, if Origin is absent)
 * is not the single configured web origin, so a SameSite bypass or an
 * old browser does not turn into a forged request.
 *
 * A request with neither header is let through only when it carries no
 * session cookie: current browsers always send Origin on these methods,
 * so a missing header means a non-browser client (curl, tests). Without
 * the cookie such a request cannot act as any user.
 */
export function createOriginCheck(env: ServerEnv) {
  const allowedOrigin = new URL(env.CORS_ORIGIN).origin;

  return function originCheck(req: Request, _res: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const source = req.get("origin") ?? originOf(req.get("referer"));
    if (source === undefined) {
      next(readSessionCookie(req, env) ? AppError.csrfRejected() : undefined);
      return;
    }

    next(source === allowedOrigin ? undefined : AppError.csrfRejected());
  };
}
