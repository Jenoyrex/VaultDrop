import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response } from "express";
import type { ServerEnv } from "@vaultdrop/config";

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_CREDENTIAL_MAX = 20;

function rateLimitedJson(_req: Request, res: Response): void {
  res.status(429).json({
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Please try again later."
    }
  });
}

function buildLimiter(windowMs: number, max: number): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitedJson
  });
}

export interface AuthRateLimiters {
  /** Applied to /auth/register and /auth/login — both carry a real
   * credential-guessing cost, so they share the same, more generous budget. */
  credentialLimiter: RateLimitRequestHandler;
  /** Applied to /auth/check-username. Read-only and free to call, so it's
   * the purest account-enumeration primitive in this API — it gets half
   * the credential routes' budget in the same window rather than its own
   * configured value, to keep the env surface small. */
  enumerationLimiter: RateLimitRequestHandler;
}

export function createAuthRateLimiters(env: ServerEnv): AuthRateLimiters {
  const windowMs = env.AUTH_RATE_LIMIT_WINDOW_MS ?? DEFAULT_WINDOW_MS;
  const credentialMax = env.AUTH_RATE_LIMIT_MAX ?? DEFAULT_CREDENTIAL_MAX;
  const enumerationMax = Math.max(1, Math.floor(credentialMax / 2));

  return {
    credentialLimiter: buildLimiter(windowMs, credentialMax),
    enumerationLimiter: buildLimiter(windowMs, enumerationMax)
  };
}
