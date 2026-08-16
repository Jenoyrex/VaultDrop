import { describe, expect, it, vi } from "vitest";
import type { loadServerEnv as LoadServerEnv } from "./server-env.js";

const REAL_RANDOM_SECRET = "kx7Qm2vT9pL4nW8rB3zY6sA1dF5hJ0cE";
const KNOWN_PLACEHOLDER_SECRET =
  "change-this-to-a-random-32-character-minimum-secret";

function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
    JWT_SECRET: REAL_RANDOM_SECRET,
    ...overrides
  };
}

/**
 * `loadServerEnv` caches its parsed result in a module-level variable for
 * the lifetime of the process — correct for a real server, which only
 * boots once, but it means every call after the first success would
 * silently return that first result regardless of what's passed in next.
 * Each test here needs a genuinely fresh module instance to actually
 * exercise its own input.
 */
async function freshLoadServerEnv(): Promise<typeof LoadServerEnv> {
  vi.resetModules();
  const mod = await import("./server-env.js");
  return mod.loadServerEnv;
}

describe("loadServerEnv", () => {
  it("accepts a real random JWT_SECRET in production", async () => {
    const loadServerEnv = await freshLoadServerEnv();
    const env = loadServerEnv(baseEnv({ NODE_ENV: "production" }));
    expect(env.JWT_SECRET).toBe(REAL_RANDOM_SECRET);
  });

  it("rejects the exact documented placeholder JWT_SECRET in production", async () => {
    const loadServerEnv = await freshLoadServerEnv();
    expect(() =>
      loadServerEnv(
        baseEnv({ NODE_ENV: "production", JWT_SECRET: KNOWN_PLACEHOLDER_SECRET })
      )
    ).toThrow(/placeholder/i);
  });

  it("rejects a JWT_SECRET containing another known-unsafe substring in production", async () => {
    const loadServerEnv = await freshLoadServerEnv();
    // 32+ characters, passes the length check, but still an obvious default.
    expect(() =>
      loadServerEnv(
        baseEnv({
          NODE_ENV: "production",
          JWT_SECRET: "my-changeme-secret-1234567890123"
        })
      )
    ).toThrow(/placeholder/i);
  });

  it("still accepts the documented placeholder in development (ergonomics preserved)", async () => {
    const loadServerEnv = await freshLoadServerEnv();
    const env = loadServerEnv(
      baseEnv({ NODE_ENV: "development", JWT_SECRET: KNOWN_PLACEHOLDER_SECRET })
    );
    expect(env.JWT_SECRET).toBe(KNOWN_PLACEHOLDER_SECRET);
  });

  it("still accepts the documented placeholder in test (existing test suites rely on this)", async () => {
    const loadServerEnv = await freshLoadServerEnv();
    const env = loadServerEnv(
      baseEnv({ NODE_ENV: "test", JWT_SECRET: KNOWN_PLACEHOLDER_SECRET })
    );
    expect(env.JWT_SECRET).toBe(KNOWN_PLACEHOLDER_SECRET);
  });

  it("still enforces the minimum-length check regardless of environment", async () => {
    const loadServerEnv = await freshLoadServerEnv();
    expect(() =>
      loadServerEnv(baseEnv({ NODE_ENV: "production", JWT_SECRET: "too-short" }))
    ).toThrow(/at least 32 characters/i);
  });

  it("defaults TRUST_PROXY_HOPS to undefined (callers fall back to 0) when unset", async () => {
    const loadServerEnv = await freshLoadServerEnv();
    const env = loadServerEnv(baseEnv({ NODE_ENV: "production" }));
    expect(env.TRUST_PROXY_HOPS).toBeUndefined();
  });

  it("coerces TRUST_PROXY_HOPS from a string env var to a number", async () => {
    const loadServerEnv = await freshLoadServerEnv();
    const env = loadServerEnv(
      baseEnv({ NODE_ENV: "production", TRUST_PROXY_HOPS: "1" })
    );
    expect(env.TRUST_PROXY_HOPS).toBe(1);
  });
});
