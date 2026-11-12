import { describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import type { ServerEnv } from "@vaultdrop/config";
import type { StorageAdapter } from "@vaultdrop/types";
import { createApp } from "../app.js";
import { createFakePrisma } from "../test-support/fake-prisma.js";

const SECRET = "proxy-secret-for-tests-at-least-32-chars";

const ENV: ServerEnv = {
  NODE_ENV: "test",
  PORT: 4000,
  DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
  JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
  JWT_EXPIRES_IN: "15m",
  STORAGE_DRIVER: "local",
  STORAGE_ROOT: "./unused",
  CORS_ORIGIN: "http://localhost:3000",
  MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
  API_PROXY_SECRET: SECRET
};

const unusedStorage = new Proxy({} as StorageAdapter, {
  get: () => () => {
    throw new Error("storage not used");
  }
});

function makeApp(env: ServerEnv = ENV) {
  return createApp(createFakePrisma().prisma, env, unusedStorage);
}

/** Same shape Netlify sends in x-nf-sign for a signed proxy redirect. */
function netlifySignature(secret = SECRET, claims: Record<string, unknown> = {}, expiresIn: string | number = "5m") {
  return jwt.sign(
    { deploy_context: "production", site_url: "https://vaultdrop95.netlify.app", ...claims },
    secret,
    { algorithm: "HS256", issuer: "netlify", expiresIn: expiresIn as jwt.SignOptions["expiresIn"] }
  );
}

describe("Netlify signed-proxy check (API_PROXY_SECRET set)", () => {
  it("rejects a direct request without x-nf-sign with 403", async () => {
    const res = await request(makeApp()).get("/auth/check-username?username=someone");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PROXY_SIGNATURE_REQUIRED");
  });

  it("accepts a request carrying a valid Netlify signature", async () => {
    const res = await request(makeApp())
      .get("/auth/check-username?username=someone")
      .set("x-nf-sign", netlifySignature());
    expect(res.status).toBe(200);
  });

  it("rejects a signature made with the wrong secret, the wrong issuer, or that has expired", async () => {
    const app = makeApp();
    const wrongSecret = netlifySignature("some-other-secret-that-is-32-chars-long");
    const wrongIssuer = jwt.sign({}, SECRET, { algorithm: "HS256", issuer: "attacker" });
    const expired = netlifySignature(SECRET, {}, -10);
    const unsigned = jwt.sign({ iss: "netlify" }, "", { algorithm: "none" });
    for (const sig of [wrongSecret, wrongIssuer, expired, unsigned, "garbage"]) {
      const res = await request(app).get("/auth/check-username?username=someone").set("x-nf-sign", sig);
      expect(res.status).toBe(403);
    }
  });

  it("leaves /health open for the platform's direct health checks", async () => {
    await request(makeApp()).get("/health").expect(200);
  });

  it("is not enforced when API_PROXY_SECRET is unset (local dev and tests)", async () => {
    const { API_PROXY_SECRET: _unused, ...devEnv } = ENV;
    const res = await request(makeApp(devEnv)).get("/auth/check-username?username=someone");
    expect(res.status).toBe(200);
  });
});
