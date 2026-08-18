import { describe, expect, it } from "vitest";
import request from "supertest";
import type { ServerEnv } from "@vaultdrop/config";
import type { StorageAdapter } from "@vaultdrop/types";
import { createApp } from "./app.js";
import { createFakePrisma } from "./test-support/fake-prisma.js";

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

const unusedStorage: StorageAdapter = {
  put: () => {
    throw new Error("not used by this test");
  },
  putStream: () => {
    throw new Error("not used by this test");
  },
  get: () => {
    throw new Error("not used by this test");
  },
  getStream: () => {
    throw new Error("not used by this test");
  },
  delete: () => {
    throw new Error("not used by this test");
  },
  exists: () => {
    throw new Error("not used by this test");
  }
};

function makeApp() {
  const { prisma } = createFakePrisma();
  return createApp(prisma, BASE_ENV, unusedStorage);
}

describe("JSON body size limit (express.json({ limit: \"2mb\" }))", () => {
  it("rejects a JSON body larger than 2mb, with a clean 413 rather than a 500 or a hang", async () => {
    const app = makeApp();

    // Comfortably over the 2mb limit; the exact route doesn't matter — the
    // size cap applies to every route behind `express.json()`, which is
    // mounted globally in app.ts before any router.
    const oversizedPassword = "a".repeat(3 * 1024 * 1024);

    const res = await request(app)
      .post("/auth/register")
      .send({ username: "someone", password: oversizedPassword });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("still accepts a normal, well-under-the-limit JSON body on the same route", async () => {
    const app = makeApp();

    const res = await request(app)
      .post("/auth/register")
      .send({ username: "someone-normal", password: "correct-horse-battery" });

    expect(res.status).toBe(201);
  });
});
