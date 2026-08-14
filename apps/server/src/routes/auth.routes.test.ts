import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  MAX_UPLOAD_BYTES: 100 * 1024 * 1024
};

// Auth routes never touch storage — this stub exists only to satisfy
// `createApp`'s signature and throws if it's ever actually called.
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

function makeApp(env: ServerEnv = BASE_ENV) {
  const { prisma } = createFakePrisma();
  return createApp(prisma, env, unusedStorage);
}

describe("POST /auth/register", () => {
  it("creates a user and returns an access token", async () => {
    const app = makeApp();
    const username = `user-${randomUUID().slice(0, 8)}`;

    const res = await request(app)
      .post("/auth/register")
      .send({ username, password: "correct-horse-battery" });

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe(username);
    expect(typeof res.body.accessToken).toBe("string");
    expect(res.body.user).not.toHaveProperty("passwordHash");
  });

  it("rejects a duplicate username with 409", async () => {
    const app = makeApp();
    const username = `user-${randomUUID().slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({ username, password: "correct-horse-battery" })
      .expect(201);

    const res = await request(app)
      .post("/auth/register")
      .send({ username, password: "a-different-password" });

    expect(res.status).toBe(409);
  });

  it("rejects a password shorter than the minimum with 400", async () => {
    const app = makeApp();

    const res = await request(app)
      .post("/auth/register")
      .send({ username: `user-${randomUUID().slice(0, 8)}`, password: "short" });

    expect(res.status).toBe(400);
  });
});

describe("POST /auth/login", () => {
  it("logs in with the correct password", async () => {
    const app = makeApp();
    const username = `user-${randomUUID().slice(0, 8)}`;
    const password = "correct-horse-battery";

    await request(app).post("/auth/register").send({ username, password }).expect(201);

    const res = await request(app).post("/auth/login").send({ username, password });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe("string");
  });

  it("rejects the wrong password with a generic 401", async () => {
    const app = makeApp();
    const username = `user-${randomUUID().slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({ username, password: "correct-horse-battery" })
      .expect(201);

    const res = await request(app)
      .post("/auth/login")
      .send({ username, password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Invalid username or password");
  });

  it("rejects a nonexistent username with the same generic 401 message", async () => {
    const app = makeApp();

    const res = await request(app)
      .post("/auth/login")
      .send({ username: `nobody-${randomUUID().slice(0, 8)}`, password: "whatever123" });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Invalid username or password");
  });
});

describe("GET /auth/me", () => {
  it("returns the current user for a valid token", async () => {
    const app = makeApp();
    const username = `user-${randomUUID().slice(0, 8)}`;
    const password = "correct-horse-battery";

    const registerRes = await request(app)
      .post("/auth/register")
      .send({ username, password })
      .expect(201);

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${registerRes.body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(username);
  });

  it("rejects a missing token with 401", async () => {
    const app = makeApp();
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects a malformed token with 401", async () => {
    const app = makeApp();
    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });
});

describe("auth rate limiting", () => {
  function lowLimitEnv(): ServerEnv {
    return { ...BASE_ENV, AUTH_RATE_LIMIT_MAX: 4, AUTH_RATE_LIMIT_WINDOW_MS: 60_000 };
  }

  it("429s /auth/login once the credential-route budget is exceeded", async () => {
    const app = makeApp(lowLimitEnv());
    const attempt = () =>
      request(app)
        .post("/auth/login")
        .send({ username: "nobody", password: "whatever123" });

    // Budget is 4 in this test env — the first 4 attempts should each get
    // a normal (401, wrong-credentials) response, not a rate-limit response.
    for (let i = 0; i < 4; i++) {
      const res = await attempt();
      expect(res.status).toBe(401);
    }

    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });

  it("limits /auth/check-username more strictly than /auth/login, on an independent budget", async () => {
    const app = makeApp(lowLimitEnv());
    const checkUsername = () => request(app).get("/auth/check-username?username=someone");

    // enumerationMax = floor(credentialMax / 2) = floor(4 / 2) = 2.
    for (let i = 0; i < 2; i++) {
      const res = await checkUsername();
      expect(res.status).toBe(200);
    }

    const limited = await checkUsername();
    expect(limited.status).toBe(429);

    // The login budget (4) is untouched by check-username traffic — it's a
    // separate limiter instance, not a shared counter.
    const loginRes = await request(app)
      .post("/auth/login")
      .send({ username: "nobody", password: "whatever123" });
    expect(loginRes.status).toBe(401);
  });
});

describe("request logging never leaks secrets", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("never logs the raw password from a login request", async () => {
    const app = makeApp();
    const username = `user-${randomUUID().slice(0, 8)}`;
    const password = "a-very-recognizable-secret-password";

    await request(app).post("/auth/register").send({ username, password }).expect(201);
    await request(app).post("/auth/login").send({ username, password }).expect(200);

    const allLoggedText = logSpy.mock.calls
      .flat()
      .concat(errorSpy.mock.calls.flat())
      .map((entry) => JSON.stringify(entry))
      .join("\n");

    expect(allLoggedText).not.toContain(password);
  });

  it("never logs the issued access token / Authorization header", async () => {
    const app = makeApp();
    const username = `user-${randomUUID().slice(0, 8)}`;
    const password = "correct-horse-battery";

    const registerRes = await request(app)
      .post("/auth/register")
      .send({ username, password })
      .expect(201);

    const token: string = registerRes.body.accessToken;

    await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const allLoggedText = logSpy.mock.calls
      .flat()
      .concat(errorSpy.mock.calls.flat())
      .map((entry) => JSON.stringify(entry))
      .join("\n");

    expect(allLoggedText).not.toContain(token);
  });

  it("logs only the expected safe fields for a request", async () => {
    const app = makeApp();
    const username = `user-${randomUUID().slice(0, 8)}`;

    await request(app)
      .post("/auth/register")
      .send({ username, password: "correct-horse-battery" })
      .expect(201);

    const requestLogLine = logSpy.mock.calls
      .map((call) => call[0] as string)
      .find((line) => {
        try {
          return JSON.parse(line).type === "request";
        } catch {
          return false;
        }
      });

    expect(requestLogLine).toBeDefined();
    const parsed = JSON.parse(requestLogLine as string);
    expect(Object.keys(parsed).sort()).toEqual(
      ["durationMs", "method", "path", "status", "timestamp", "type"].sort()
    );
    expect(parsed.path).toBe("/auth/register");
    expect(parsed.method).toBe("POST");
    expect(parsed.status).toBe(201);
  });
});
