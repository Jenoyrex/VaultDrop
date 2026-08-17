import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CloudStorageAdapter } from "./cloud-storage-adapter.js";

/**
 * Live connectivity test against a real Backblaze B2 (S3-compatible)
 * bucket. Skipped unless RUN_B2_LIVE_TEST=1 is set *and* every
 * CLOUD_STORAGE_* variable the adapter needs is present — so a plain
 * `pnpm test` / CI run never touches the network or requires B2
 * credentials. Run manually with:
 *
 *   RUN_B2_LIVE_TEST=1 pnpm --filter server test cloud-storage-adapter.live
 */
const bucket = process.env["CLOUD_STORAGE_BUCKET"];
const region = process.env["CLOUD_STORAGE_REGION"];
const endpoint = process.env["CLOUD_STORAGE_ENDPOINT"];
const accessKeyId = process.env["CLOUD_STORAGE_ACCESS_KEY_ID"];
const secretAccessKey = process.env["CLOUD_STORAGE_SECRET_ACCESS_KEY"];

const hasLiveCredentials = Boolean(
  bucket && region && endpoint && accessKeyId && secretAccessKey
);
const liveTestOptedIn = process.env["RUN_B2_LIVE_TEST"] === "1";

describe.skipIf(!liveTestOptedIn || !hasLiveCredentials)(
  "CloudStorageAdapter (live Backblaze B2)",
  () => {
    const adapter = new CloudStorageAdapter({
      bucket: bucket as string,
      region: region as string,
      endpoint,
      forcePathStyle: process.env["CLOUD_STORAGE_FORCE_PATH_STYLE"] === "true",
      credentials: { accessKeyId: accessKeyId as string, secretAccessKey: secretAccessKey as string }
    });
    const key = `__live_connectivity_test__/${randomUUID()}.txt`;

    it("puts, gets, and deletes a real object round-trip", async () => {
      const payload = Buffer.from(`vaultdrop live connectivity check ${randomUUID()}`);
      try {
        await adapter.put({ key, data: payload, contentType: "text/plain" });
        const downloaded = await adapter.get(key);
        expect(Buffer.compare(downloaded, payload)).toBe(0);
      } finally {
        await adapter.delete(key);
      }
    });
  }
);
