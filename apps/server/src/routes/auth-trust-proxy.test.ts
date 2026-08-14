import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import type { ServerEnv } from "@vaultdrop/config";
import type { StorageAdapter } from "@vaultdrop/types";
import { createApp } from "../app.js";
import { createFakePrisma } from "../test-support/fake-prisma.js";

const BASE_ENV: ServerEnv = {
  NODE_ENV: "test",
  PORT: 4000,
  DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
  JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
  JWT_EXPIRES_IN: "15m",
  STORAGE_DRIVER: "local",
  STORAGE_ROOT: "./unused",
  CORS_ORIGIN: "http://localhost:3000",
  MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
  AUTH_RATE_LIMIT_MAX: 3,
  AUTH_RATE_LIMIT_WINDOW_MS: 60_000
};

const unusedStorage: StorageAdapter = {
  put: () => {
    throw new Error("not used by auth routes");
  },
  putStream: () => {
    throw new Error("not used by auth routes");
  },
  get: () => {
    throw new Error("not used by auth routes");
  },
  getStream: () => {
    throw new Error("not used by auth routes");
  },
  delete: () => {
    throw new Error("not used by auth routes");
  },
  exists: () => {
    throw new Error("not used by auth routes");
  }
};

function makeApp(env: ServerEnv) {
  const { prisma } = createFakePrisma();
  return createApp(prisma, env, unusedStorage);
}

function attemptLogin(app: ReturnType<typeof makeApp>, forwardedFor?: string) {
  const req = request(app)
    .post("/auth/login")
    .send({ username: `nobody-${randomUUID().slice(0, 8)}`, password: "whatever123" });

  return forwardedFor ? req.set("X-Forwarded-For", forwardedFor) : req;
}

describe("trust proxy / X-Forwarded-For behavior", () => {
  it("with TRUST_PROXY_HOPS=1, two different forwarded client IPs each get their own independent rate-limit budget", async () => {
    const app = makeApp({ ...BASE_ENV, TRUST_PROXY_HOPS: 1 });

    // Exhaust the budget (3) for the first simulated client IP.
    for (let i = 0; i < 3; i++) {
      const res = await attemptLogin(app, "203.0.113.10");
      expect(res.status).toBe(401);
    }
    const limitedFirstIp = await attemptLogin(app, "203.0.113.10");
    expect(limitedFirstIp.status).toBe(429);

    // A different forwarded client IP is unaffected — proves the limiter
    // is keying on the real (forwarded) client IP, not collapsing every
    // request behind the proxy into one shared bucket.
    const secondIpRes = await attemptLogin(app, "203.0.113.99");
    expect(secondIpRes.status).toBe(401);
  });

  it("with TRUST_PROXY_HOPS=1, exhausting one forwarded IP's budget doesn't 429 a different one", async () => {
    const app = makeApp({ ...BASE_ENV, TRUST_PROXY_HOPS: 1 });

    for (let i = 0; i < 3; i++) {
      await attemptLogin(app, "198.51.100.1");
    }
    const limited = await attemptLogin(app, "198.51.100.1");
    expect(limited.status).toBe(429);

    const otherIp = await attemptLogin(app, "198.51.100.2");
    expect(otherIp.status).toBe(401);
  });

  it("with the default TRUST_PROXY_HOPS (unset, no proxy trusted), a spoofed X-Forwarded-For does not crash the server and does not change the rate-limit key", async () => {
    // No TRUST_PROXY_HOPS set at all — matches an env that predates this
    // change, and matches any deployment with no reverse proxy in front.
    const app = makeApp(BASE_ENV);

    // All requests come from the same real (supertest) connection, so
    // regardless of what X-Forwarded-For claims, they must all share one
    // budget — proving the header is safely ignored, not accidentally
    // trusted, and proving no ERR_ERL_UNEXPECTED_X_FORWARDED_FOR-style
    // crash occurs when trust proxy is left at its safe default.
    for (let i = 0; i < 3; i++) {
      const res = await attemptLogin(app, `10.0.0.${i}`);
      expect(res.status).toBe(401);
    }
    const limited = await attemptLogin(app, "10.0.0.99");
    expect(limited.status).toBe(429);
  });
});
