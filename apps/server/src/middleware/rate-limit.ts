import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response } from "express";
import type { ServerEnv } from "@vaultdrop/config";

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_CREDENTIAL_MAX = 20;

const DEFAULT_API_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_API_MAX = 300;
const DEFAULT_UPLOAD_MAX = 30;
const DEFAULT_DOWNLOAD_MAX = 60;

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

/**
 * Keys per authenticated user (`req.user.sub`) rather than per IP. Every
 * route these limiters apply to already requires a valid JWT (mounted
 * after `requireAuth`), so the account identity is available and is a
 * more meaningful abuse signal here than IP: it doesn't penalize users
 * sharing a NAT/office IP, and can't be evaded by rotating IP while
 * reusing one token. This also means these limiters are entirely
 * unaffected by `TRUST_PROXY_HOPS`/`X-Forwarded-For` — they never
 * consult `req.ip` in normal operation. The fallback to `req.ip` only
 * exists for the defensive, shouldn't-happen case where `req.user` is
 * somehow unset despite `requireAuth` having already run.
 */
function perUserKey(req: Request): string {
  return req.user?.sub ?? req.ip ?? "unknown";
}

function buildPerUserLimiter(windowMs: number, max: number): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitedJson,
    keyGenerator: perUserKey
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

/**
 * Per-user API abuse-protection limiters, layered: every authenticated
 * route (`vault`/`folder`/`file` routers) consumes from
 * `generalApiLimiter`; upload routes (`/upload`, `/upload-encrypted`)
 * ADDITIONALLY consume from `uploadLimiter`; download/preview routes
 * (`/:fileId/download`, `/:fileId/preview`) ADDITIONALLY consume from
 * `downloadLimiter`. All three are separate counters (separate
 * `rateLimit()` instances, separate internal stores) — exhausting one
 * never affects the others. `/upload` and `/upload-encrypted` share the
 * single `uploadLimiter` instance (one bucket for both); `/download` and
 * `/preview` share the single `downloadLimiter` instance (one bucket for
 * both) — this is what "shared budget" means structurally: the *same*
 * limiter middleware function is mounted on both routes in each pair,
 * not two separately-configured limiters with matching numbers.
 *
 * Counting is per-request, not per-byte or per-duration: `express-rate-
 * limit` increments its counter once when the middleware runs, before
 * the route handler (and therefore before multer/streaming/storage
 * access) ever starts — a large, slow file consumes exactly the same "1
 * request" as a small, instant one, and the limiter never reads or
 * throttles the byte stream itself.
 *
 * IMPORTANT — in-memory store, single-instance only: these (like the
 * auth limiters above) use express-rate-limit's default `MemoryStore`,
 * so counters live in this process's memory only. If this server is ever
 * horizontally scaled to multiple instances behind a load balancer, each
 * instance enforces its own independent budget — a user routed across N
 * instances effectively gets up to N times the intended ceiling. Fixing
 * this requires a shared external store (e.g. Redis via
 * `rate-limit-redis`), which is a deliberate, out-of-scope decision for
 * this checkpoint — there is no such shared store anywhere in this repo
 * today, and introducing one is a real infrastructure addition, not a
 * config tweak.
 */
export interface ApiRateLimiters {
  generalApiLimiter: RateLimitRequestHandler;
  uploadLimiter: RateLimitRequestHandler;
  downloadLimiter: RateLimitRequestHandler;
}

export function createApiRateLimiters(env: ServerEnv): ApiRateLimiters {
  const windowMs = env.API_RATE_LIMIT_WINDOW_MS ?? DEFAULT_API_WINDOW_MS;
  const apiMax = env.API_RATE_LIMIT_MAX ?? DEFAULT_API_MAX;
  const uploadMax = env.UPLOAD_RATE_LIMIT_MAX ?? DEFAULT_UPLOAD_MAX;
  const downloadMax = env.DOWNLOAD_RATE_LIMIT_MAX ?? DEFAULT_DOWNLOAD_MAX;

  return {
    generalApiLimiter: buildPerUserLimiter(windowMs, apiMax),
    uploadLimiter: buildPerUserLimiter(windowMs, uploadMax),
    downloadLimiter: buildPerUserLimiter(windowMs, downloadMax)
  };
}
