import type { CookieOptions, NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { InvalidTokenError, verifyAccessToken } from "@vaultdrop/crypto";
import type { ServerEnv } from "@vaultdrop/config";
import { AppError } from "../utils/app-error.js";
import { asyncHandler } from "../utils/async-handler.js";

/**
 * The session token lives only in this httpOnly cookie — never in a JSON
 * body, never readable by browser JavaScript. In production the `__Host-`
 * prefix makes the browser refuse the cookie unless it is Secure, has
 * Path=/ and has no Domain attribute, so no sibling subdomain can plant or
 * overwrite it. Local dev runs over plain http://localhost, where neither
 * `Secure` nor `__Host-` work in every browser, so both are production-only.
 */
export function sessionCookieName(env: ServerEnv): string {
  return env.NODE_ENV === "production" ? "__Host-vaultdrop_session" : "vaultdrop_session";
}

function sessionCookieOptions(env: ServerEnv): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    // The web app reaches the API through a same-origin /api proxy in
    // production (see docs/design-decisions.md), so Lax is enough: the
    // cookie is never needed on a cross-site request.
    sameSite: "lax",
    path: "/"
  };
}

export function setSessionCookie(res: Response, env: ServerEnv, token: string): void {
  // Cookie lifetime tracks the token's own `exp`, so the browser drops the
  // cookie at the same moment the server would start rejecting it.
  const { exp } = verifyAccessToken(token, env.JWT_SECRET);
  res.cookie(sessionCookieName(env), token, {
    ...sessionCookieOptions(env),
    ...(exp !== undefined ? { expires: new Date(exp * 1000) } : {})
  });
}

export function clearSessionCookie(res: Response, env: ServerEnv): void {
  res.clearCookie(sessionCookieName(env), sessionCookieOptions(env));
}

export function readSessionCookie(req: Request, env: ServerEnv): string | undefined {
  const name = sessionCookieName(env);
  for (const part of req.headers.cookie?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim() || undefined;
    }
  }
  return undefined;
}

/**
 * Authenticates from the session cookie. A valid signature is necessary
 * but not sufficient: the token's `ver` must still equal the user's
 * current `tokenVersion`, which is what makes logout and password change
 * revoke tokens server-side. Costs one primary-key lookup per request.
 */
export function createAuthMiddleware(env: ServerEnv, prisma: PrismaClient) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const token = readSessionCookie(req, env);
    if (!token) {
      throw AppError.invalidToken("Missing session cookie");
    }

    let payload;
    try {
      payload = verifyAccessToken(token, env.JWT_SECRET);
    } catch (error) {
      throw error instanceof InvalidTokenError
        ? AppError.invalidToken(error.message)
        : AppError.invalidToken();
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { tokenVersion: true }
    });
    if (!user || user.tokenVersion !== payload.ver) {
      throw AppError.invalidToken("Session has been revoked");
    }

    req.user = payload;
    next();
  });
}
