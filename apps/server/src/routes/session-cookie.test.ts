import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import type { ServerEnv } from "@vaultdrop/config";
import type { StorageAdapter } from "@vaultdrop/types";
import { signAccessToken } from "@vaultdrop/crypto";
import { createApp } from "../app.js";
import { createFakePrisma } from "../test-support/fake-prisma.js";

/**
 * Phase 1 session hardening: the session token lives only in an httpOnly
 * cookie, is revocable server-side via User.tokenVersion, and every
 * state-changing request is subject to an Origin/Referer check.
 */

const WEB_ORIGIN = "http://localhost:3000";

const TEST_ENV: ServerEnv = {
  NODE_ENV: "test",
  PORT: 4000,
  DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
  JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
  JWT_EXPIRES_IN: "15m",
  STORAGE_DRIVER: "local",
  STORAGE_ROOT: "./unused",
  CORS_ORIGIN: WEB_ORIGIN,
  MAX_UPLOAD_BYTES: 100 * 1024 * 1024
};

const PROD_ENV: ServerEnv = { ...TEST_ENV, NODE_ENV: "production", CORS_ORIGIN: "https://app.example.test" };

const unusedStorage = new Proxy({} as StorageAdapter, {
  get: () => () => {
    throw new Error("storage not used in session tests");
  }
});

const PASSWORD = "correct-horse-battery";

function makeApp(env: ServerEnv = TEST_ENV) {
  const fake = createFakePrisma();
  return { app: createApp(fake.prisma, env, unusedStorage), users: fake.users };
}

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  return (res.headers["set-cookie"] as string[] | undefined) ?? [];
}

function tokenFrom(res: { headers: Record<string, unknown> }, name = "vaultdrop_session"): string {
  const match = setCookies(res)
    .map((c) => new RegExp(`^${name}=([^;]*)`).exec(c))
    .find(Boolean);
  if (!match?.[1]) throw new Error(`no ${name} cookie set`);
  return match[1];
}

async function registerAndGetToken(app: ReturnType<typeof makeApp>["app"]) {
  const username = `user-${randomUUID().slice(0, 8)}`;
  const res = await request(app).post("/auth/register").send({ username, password: PASSWORD }).expect(201);
  return { username, token: tokenFrom(res), res };
}

describe("session cookie flags", () => {
  it("sets an httpOnly, SameSite=Lax, Path=/ cookie with an expiry on login (dev/test env)", async () => {
    const { app } = makeApp();
    const { username } = await registerAndGetToken(app);

    const res = await request(app).post("/auth/login").send({ username, password: PASSWORD }).expect(200);
    const cookie = setCookies(res).find((c) => c.startsWith("vaultdrop_session="));

    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).toMatch(/; Path=\//);
    expect(cookie).toMatch(/; Expires=/);
    expect(cookie).not.toMatch(/; Domain=/);
  });

  it("in production uses the __Host- prefix and the Secure flag", async () => {
    const { app } = makeApp(PROD_ENV);
    const res = await request(app)
      .post("/auth/register")
      .set("Origin", "https://app.example.test")
      .send({ username: `user-${randomUUID().slice(0, 8)}`, password: PASSWORD })
      .expect(201);

    const cookie = setCookies(res).find((c) => c.startsWith("__Host-vaultdrop_session="));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).toMatch(/; Path=\//);
    expect(cookie).not.toMatch(/; Domain=/);
  });
});

describe("token never appears in a response body", () => {
  it("register, login, me and password change bodies contain no token", async () => {
    const { app } = makeApp();
    const { username, token, res: registerRes } = await registerAndGetToken(app);

    const loginRes = await request(app).post("/auth/login").send({ username, password: PASSWORD }).expect(200);
    const loginToken = tokenFrom(loginRes);

    const meRes = await request(app)
      .get("/auth/me")
      .set("Cookie", `vaultdrop_session=${loginToken}`)
      .expect(200);

    const pwRes = await request(app)
      .put("/auth/password")
      .set("Cookie", `vaultdrop_session=${loginToken}`)
      .set("Origin", WEB_ORIGIN)
      .send({ currentPassword: PASSWORD, newPassword: "another-long-password", vaults: [] })
      .expect(204);
    const newToken = tokenFrom(pwRes);

    for (const res of [registerRes, loginRes, meRes, pwRes]) {
      const body = JSON.stringify(res.body ?? {});
      expect(body).not.toContain(token);
      expect(body).not.toContain(loginToken);
      expect(body).not.toContain(newToken);
      expect(body).not.toMatch(/accessToken/i);
    }
  });
});

describe("requests without the cookie", () => {
  it("get 401 INVALID_TOKEN on protected routes", async () => {
    const { app } = makeApp();
    for (const path of ["/auth/me", "/vaults"]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_TOKEN");
    }
  });

  it("no longer accept a bearer token in the Authorization header", async () => {
    const { app } = makeApp();
    const { token } = await registerAndGetToken(app);
    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("reject a validly signed token for a user that no longer exists", async () => {
    const { app } = makeApp();
    const orphan = signAccessToken({
      userId: randomUUID(),
      username: "ghost",
      tokenVersion: 0,
      secret: TEST_ENV.JWT_SECRET,
      expiresIn: "15m"
    });
    const res = await request(app).get("/auth/me").set("Cookie", `vaultdrop_session=${orphan}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });
});

describe("CSRF: Origin/Referer check on state-changing requests", () => {
  it("rejects a cookie-bearing POST from a foreign Origin with 403 before it runs", async () => {
    const { app } = makeApp();
    const { token } = await registerAndGetToken(app);

    const res = await request(app)
      .post("/vaults")
      .set("Cookie", `vaultdrop_session=${token}`)
      .set("Origin", "https://evil.example")
      .send({ name: "x" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CSRF_REJECTED");
  });

  it("rejects a foreign Origin even on login (login CSRF)", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/auth/login")
      .set("Origin", "https://evil.example")
      .send({ username: "someone", password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CSRF_REJECTED");
  });

  it("rejects Origin: null (sandboxed iframe / opaque origin)", async () => {
    const { app } = makeApp();
    const { token } = await registerAndGetToken(app);
    const res = await request(app)
      .post("/auth/logout")
      .set("Cookie", `vaultdrop_session=${token}`)
      .set("Origin", "null");
    expect(res.status).toBe(403);
  });

  it("falls back to Referer when Origin is absent", async () => {
    const { app } = makeApp();
    const { token } = await registerAndGetToken(app);

    const bad = await request(app)
      .delete(`/vaults/${randomUUID()}`)
      .set("Cookie", `vaultdrop_session=${token}`)
      .set("Referer", "https://evil.example/page");
    expect(bad.status).toBe(403);

    const good = await request(app)
      .delete(`/vaults/${randomUUID()}`)
      .set("Cookie", `vaultdrop_session=${token}`)
      .set("Referer", `${WEB_ORIGIN}/dashboard`);
    expect(good.status).toBe(404); // passed the CSRF check, then: no such vault
  });

  it("rejects a cookie-bearing state change with neither Origin nor Referer", async () => {
    const { app } = makeApp();
    const { token } = await registerAndGetToken(app);
    const res = await request(app)
      .put("/auth/password")
      .set("Cookie", `vaultdrop_session=${token}`)
      .send({ currentPassword: PASSWORD, newPassword: "another-long-password", vaults: [] });
    expect(res.status).toBe(403);
  });

  it("allows the configured web Origin", async () => {
    const { app } = makeApp();
    const { token } = await registerAndGetToken(app);
    const res = await request(app)
      .put("/auth/password")
      .set("Cookie", `vaultdrop_session=${token}`)
      .set("Origin", WEB_ORIGIN)
      .send({ currentPassword: PASSWORD, newPassword: "another-long-password", vaults: [] });
    expect(res.status).toBe(204);
  });

  it("does not apply to safe methods", async () => {
    const { app } = makeApp();
    const { token } = await registerAndGetToken(app);
    await request(app)
      .get("/auth/me")
      .set("Cookie", `vaultdrop_session=${token}`)
      .set("Origin", "https://evil.example")
      .expect(200);
  });
});

describe("per-IP flood ceiling", () => {
  it("rate-limits requests before the session check reaches the database", async () => {
    // Ceiling is 10x API_RATE_LIMIT_MAX per IP: 10 here.
    const { app } = makeApp({ ...TEST_ENV, API_RATE_LIMIT_MAX: 1, API_RATE_LIMIT_WINDOW_MS: 60_000 });
    for (let i = 0; i < 10; i++) {
      expect((await request(app).get("/auth/me")).status).toBe(401);
    }
    const limited = await request(app).get("/auth/me");
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });
});

describe("server-side session invalidation", () => {
  it("logout clears the cookie and makes the old token unusable", async () => {
    const { app } = makeApp();
    const { token } = await registerAndGetToken(app);

    await request(app).get("/auth/me").set("Cookie", `vaultdrop_session=${token}`).expect(200);

    const logoutRes = await request(app)
      .post("/auth/logout")
      .set("Cookie", `vaultdrop_session=${token}`)
      .set("Origin", WEB_ORIGIN)
      .expect(204);

    const cleared = setCookies(logoutRes).find((c) => c.startsWith("vaultdrop_session="));
    expect(cleared).toMatch(/^vaultdrop_session=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    // A copy of the token taken before logout (e.g. exfiltrated) is now dead.
    const replay = await request(app).get("/auth/me").set("Cookie", `vaultdrop_session=${token}`);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("INVALID_TOKEN");
  });

  it("logout revokes the user's other sessions too", async () => {
    const { app } = makeApp();
    const { username, token: first } = await registerAndGetToken(app);
    const secondRes = await request(app).post("/auth/login").send({ username, password: PASSWORD }).expect(200);
    const second = tokenFrom(secondRes);

    await request(app).post("/auth/logout").set("Cookie", `vaultdrop_session=${second}`).set("Origin", WEB_ORIGIN).expect(204);

    await request(app).get("/auth/me").set("Cookie", `vaultdrop_session=${first}`).expect(401);
  });

  it("logout with no or an invalid cookie still succeeds and clears it", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/auth/logout")
      .set("Cookie", "vaultdrop_session=garbage")
      .set("Origin", WEB_ORIGIN)
      .expect(204);
    expect(setCookies(res).some((c) => c.startsWith("vaultdrop_session=;"))).toBe(true);

    await request(app).post("/auth/logout").expect(204);
  });

  it("password change revokes old tokens but keeps this device signed in with a fresh cookie", async () => {
    const { app } = makeApp();
    const { username, token: thisDevice } = await registerAndGetToken(app);
    const otherRes = await request(app).post("/auth/login").send({ username, password: PASSWORD }).expect(200);
    const otherDevice = tokenFrom(otherRes);

    const pwRes = await request(app)
      .put("/auth/password")
      .set("Cookie", `vaultdrop_session=${thisDevice}`)
      .set("Origin", WEB_ORIGIN)
      .send({ currentPassword: PASSWORD, newPassword: "another-long-password", vaults: [] })
      .expect(204);
    const fresh = tokenFrom(pwRes);

    await request(app).get("/auth/me").set("Cookie", `vaultdrop_session=${thisDevice}`).expect(401);
    await request(app).get("/auth/me").set("Cookie", `vaultdrop_session=${otherDevice}`).expect(401);
    await request(app).get("/auth/me").set("Cookie", `vaultdrop_session=${fresh}`).expect(200);
  });
});
