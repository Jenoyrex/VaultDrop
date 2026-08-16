import { describe, expect, it } from "vitest";
import { generateAesKey } from "@/lib/crypto";
import { fileApi, UnsupportedBrowserError } from "./api-client.js";

// Kept in its own file: the streaming-body feature-detect result is
// memoized at module scope on first use, so this needs to run against a
// module instance that hasn't already cached "supported" from another
// test file's real (Node-supported) fetch.
describe("fileApi.uploadEncrypted — unsupported browser", () => {
  it("throws UnsupportedBrowserError instead of silently buffering the whole file when the runtime lacks streaming request bodies", async () => {
    const originalRequest = globalThis.Request;
    // Simulates a browser without fetch streaming-body support, without
    // relying on `delete` (built-in globals aren't guaranteed configurable).
    (globalThis as { Request?: typeof Request }).Request = undefined;

    try {
      const vaultDek = await generateAesKey();
      const file = new File(["hello"], "hello.txt", { type: "text/plain" });

      await expect(
        fileApi.uploadEncrypted("vault-1", file, vaultDek, "token")
      ).rejects.toBeInstanceOf(UnsupportedBrowserError);
    } finally {
      globalThis.Request = originalRequest;
    }
  });
});
