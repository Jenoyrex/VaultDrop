import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

/**
 * Stands in for `@aws-sdk/lib-storage`'s real `Upload` class. It only
 * reproduces the one contract `CloudStorageAdapter.putStream` actually
 * depends on: `Upload` reads `params.Body` (the stream `putStream` hands
 * it) to completion, and `.done()` resolves once that read finishes or
 * rejects if the stream errors partway through.
 *
 * This lets these tests exercise `CloudStorageAdapter`'s own stream
 * wiring — the exact thing the fix below changes — deterministically and
 * without real AWS network access or credentials. It does NOT exercise
 * the real `Upload` class's multipart-vs-single-part decision logic,
 * retries, or S3 endpoint/credential resolution; those remain unverified
 * without live credentials against a real or S3-compatible (e.g. MinIO)
 * endpoint. See the "oversized upload against a real CloudStorageAdapter"
 * test in `../routes/upload.test.ts` for a complementary regression test
 * that exercises the *real* `Upload` and `S3Client` classes end-to-end
 * for the failure path (which never reaches the network, so it needs no
 * mocking at all).
 *
 * Defined via `vi.hoisted` because `vi.mock` factories below run before
 * this file's own top-level code — without it, `FakeUpload` wouldn't be
 * initialized yet the first time the factory runs.
 */
const { FakeUpload } = vi.hoisted(() => {
  class FakeUpload {
    private readonly body: NodeJS.ReadableStream;

    constructor(options: { params: { Body: NodeJS.ReadableStream } }) {
      this.body = options.params.Body;
    }

    async done(): Promise<{ Bucket: string; Key: string }> {
      return await new Promise((resolve, reject) => {
        this.body.on("data", () => undefined);
        this.body.on("end", () => resolve({ Bucket: "fake-bucket", Key: "fake-key" }));
        this.body.on("error", (err: Error) => reject(err));
      });
    }
  }

  return { FakeUpload };
});

vi.mock("@aws-sdk/lib-storage", () => ({
  Upload: FakeUpload
}));

// `vi.mock` is hoisted above this import by vitest's transform, so it
// already resolves against the mocked `@aws-sdk/lib-storage`.
import { CloudStorageAdapter } from "./cloud-storage-adapter.js";

function adapter() {
  return new CloudStorageAdapter({ bucket: "test-bucket", region: "us-east-1" });
}

/** A stream that emits `validChunks` and then destroys itself with `error` — mirrors the upload route's `enforceMaxSize` Transform rejecting an oversized request mid-stream. */
function streamThatErrorsAfter(validChunks: Buffer[], error: Error): Readable {
  let index = 0;

  return new Readable({
    read() {
      if (index < validChunks.length) {
        this.push(validChunks[index]);
        index += 1;
        return;
      }
      this.destroy(error);
    }
  });
}

describe("CloudStorageAdapter.putStream", () => {
  it("resolves with the correct byte count for a valid upload well under the size limit", async () => {
    const payload = Buffer.from("a valid, well-under-the-limit encrypted upload");
    const source = Readable.from([payload]);

    const meta = await adapter().putStream("vault-1/file-1", source, "application/octet-stream");

    expect(meta.key).toBe("vault-1/file-1");
    expect(meta.contentType).toBe("application/octet-stream");
    expect(meta.sizeBytes).toBe(payload.length);
  });

  it(
    "rejects promptly — rather than hanging — when the source stream errors partway through (regression: oversized upload)",
    async () => {
      const oversizedError = new Error("File exceeds the maximum upload size");
      const source = streamThatErrorsAfter(
        [Buffer.from("some valid bytes before the limit is hit")],
        oversizedError
      );

      await expect(
        adapter().putStream("vault-1/file-2", source, "application/octet-stream")
      ).rejects.toThrow("File exceeds the maximum upload size");
    },
    { timeout: 2000 }
  );

  it(
    "rejects promptly when the source stream errors immediately (cut off before any data arrived)",
    async () => {
      const error = new Error("simulated: connection reset before any data arrived");
      const source = streamThatErrorsAfter([], error);

      await expect(
        adapter().putStream("vault-1/file-3", source, "application/octet-stream")
      ).rejects.toThrow("simulated: connection reset before any data arrived");
    },
    { timeout: 2000 }
  );
});
