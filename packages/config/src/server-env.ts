import { z } from "zod";

/**
 * Known-unsafe JWT_SECRET values that must never be used in production —
 * currently just the literal placeholder documented in
 * `apps/server/.env.example`, plus a small set of other obviously-generic
 * defaults, matched as case-insensitive substrings. This intentionally
 * does NOT attempt to score general secret entropy (too fuzzy, too easy
 * to get wrong) — only known placeholder patterns.
 */
const UNSAFE_JWT_SECRET_SUBSTRINGS = [
  "change-this-to-a-random-32-character-minimum-secret",
  "changeme",
  "placeholder",
  "your-secret",
  "example-secret"
];

function isUnsafeJwtSecret(secret: string): boolean {
  const lower = secret.toLowerCase();
  return UNSAFE_JWT_SECRET_SUBSTRINGS.some((unsafe) => lower.includes(unsafe));
}

/**
 * Strict, validated environment configuration for the Express server.
 * Throws synchronously on boot if anything required is missing or malformed.
 */
const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    JWT_EXPIRES_IN: z.string().default("15m"),
    STORAGE_DRIVER: z.enum(["local", "cloud"]).default("local"),
    STORAGE_ROOT: z.string().default("./storage"),
    CORS_ORIGIN: z.string().default("http://localhost:3000"),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
    /** Sliding window for auth-route rate limiting, in ms. Optional — the
     * rate limiter falls back to its own built-in default when unset, so
     * existing deployments/tests that don't set this keep working unchanged. */
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional(),
    /** Max requests per window for the credential-bearing auth routes
     * (register, login). Optional for the same reason as the window above. */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
    /**
     * Number of reverse-proxy hops to trust when determining the real
     * client IP from `X-Forwarded-For` (Express's `trust proxy` setting).
     * Optional, falling back to 0 (no proxy trusted, `req.ip` is the raw
     * socket address) wherever it's read — which reproduces today's exact
     * behavior for local dev/tests and any direct (no-proxy) deployment,
     * so existing ServerEnv literals that don't set this keep working
     * unchanged. Set this to the actual number of proxies in front of the
     * server (typically `1`) so rate limiting keys on the real client IP
     * instead of the proxy's. Deliberately numeric, never the blanket
     * `true` value, which `express-rate-limit` itself refuses to key on
     * since it makes the limiter trivially bypassable via a spoofed header.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).optional()
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === "production" && isUnsafeJwtSecret(data.JWT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_SECRET"],
        message:
          "JWT_SECRET looks like a placeholder/default value and must be changed before running in production"
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server environment configuration: ${issues}`);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}
