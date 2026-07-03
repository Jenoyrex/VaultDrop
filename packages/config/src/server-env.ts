import { z } from "zod";

/**
 * Strict, validated environment configuration for the Express server.
 * Throws synchronously on boot if anything required is missing or malformed.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("15m"),
  STORAGE_DRIVER: z.enum(["local", "cloud"]).default("local"),
  STORAGE_ROOT: z.string().default("./storage"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024)
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
