import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import type { ServerEnv } from "@vaultdrop/config";
import type { StorageAdapter } from "@vaultdrop/types";
import { signAccessToken } from "@vaultdrop/crypto";
import { createApp } from "../app.js";
import { createFakePrisma, testUser } from "../test-support/fake-prisma.js";

/**
 * TRUST_PROXY_HOPS and the temporary /debug/ip verification endpoint.
 *
 * Express counts hops from the app outward: hop 1 is the TCP peer (the
 * last proxy), then X-Forwarded-For is read right to left. With
 * TRUST_PROXY_HOPS=N, req.ip is the address N hops away, so every entry
 * further left (which the client can write itself) is ignored.
 *
 * In these tests the TCP peer is supertest's loopback socket, standing in
 * for the platform load balancer. Addresses are documentation ranges.
 */

const CLIENT = "198.51.100.10";
const EDGE = "203.0.113.50"; // e.g. the Netlify edge, as recorded by the next proxy
const FORGED = "6.6.6.6";

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

const unusedStorage = new Proxy({} as StorageAdapter, {
  get: () => () => {
    throw new Error("storage not used");
  }
});

function setup(env: Partial<ServerEnv>) {
  const userId = randomUUID();
  const { prisma } = createFakePrisma([], [testUser(userId)]);
  const app = createApp(prisma, { ...BASE_ENV, ...env }, unusedStorage);
  const token = signAccessToken({
    userId,
    username: "tester",
    tokenVersion: 0,
    secret: BASE_ENV.JWT_SECRET,
    expiresIn: "15m"
  });
  const echo = (xff?: string) => {
    const req = request(app).get("/debug/ip").set("Cookie", `vaultdrop_session=${token}`);
    return xff === undefined ? req : req.set("X-Forwarded-For", xff);
  };
  return { app, echo };
}

describe("/debug/ip endpoint", () => {
  it("is not mounted by default (404)", async () => {
    const { echo } = setup({});
    const res = await echo();
    expect(res.status).toBe(404);
  });

  it("is not mounted when DEBUG_IP_ECHO=0 (404)", async () => {
    const { echo } = setup({ DEBUG_IP_ECHO: "0" });
    expect((await echo()).status).toBe(404);
  });

  it("when DEBUG_IP_ECHO=1, requires a session (401 without the cookie)", async () => {
    const { app } = setup({ DEBUG_IP_ECHO: "1" });
    const res = await request(app).get("/debug/ip");
    expect(res.status).toBe(401);
  });

  it("when DEBUG_IP_ECHO=1, echoes req.ip and the raw X-Forwarded-For", async () => {
    const { echo } = setup({ DEBUG_IP_ECHO: "1", TRUST_PROXY_HOPS: 2 });
    const res = await echo(`${CLIENT}, ${EDGE}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ip: CLIENT, ips: [CLIENT, EDGE], xff: `${CLIENT}, ${EDGE}` });
  });
});

describe("TRUST_PROXY_HOPS=2 (browser -> edge proxy -> load balancer -> app)", () => {
  it("with the real chain, req.ip is the client", async () => {
    const { echo } = setup({ DEBUG_IP_ECHO: "1", TRUST_PROXY_HOPS: 2 });
    expect((await echo(`${CLIENT}, ${EDGE}`)).body.ip).toBe(CLIENT);
  });

  it("a forged leading X-Forwarded-For entry does not change req.ip", async () => {
    const { echo } = setup({ DEBUG_IP_ECHO: "1", TRUST_PROXY_HOPS: 2 });
    expect((await echo(`${FORGED}, ${CLIENT}, ${EDGE}`)).body.ip).toBe(CLIENT);
    expect((await echo(`10.0.0.1, ${FORGED}, ${CLIENT}, ${EDGE}`)).body.ip).toBe(CLIENT);
  });

  it("documents the failure modes either side of the right count", async () => {
    // One too low: every user would appear as the edge proxy (one shared bucket).
    const low = setup({ DEBUG_IP_ECHO: "1", TRUST_PROXY_HOPS: 1 });
    expect((await low.echo(`${FORGED}, ${CLIENT}, ${EDGE}`)).body.ip).toBe(EDGE);
    // One too high: the client-written entry becomes req.ip (spoofable).
    const high = setup({ DEBUG_IP_ECHO: "1", TRUST_PROXY_HOPS: 3 });
    expect((await high.echo(`${FORGED}, ${CLIENT}, ${EDGE}`)).body.ip).toBe(FORGED);
  });
});
