import { describe, expect, it, vi, afterEach } from "vitest";
import { generateAesKey } from "@/lib/crypto";
import { authApi, fileApi, onSessionExpired } from "./api-client.js";

describe("fileApi.uploadEncrypted", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("streams ciphertext as the raw request body with duplex:'half', not multipart form data, with the wrapped key and metadata carried as query params", async () => {
    const vaultDek = await generateAesKey();
    const file = new File(["hello world"], "hello.txt", {
      type: "text/plain"
    });

    let capturedUrl: string | undefined;
    let capturedInit: (RequestInit & { duplex?: string }) | undefined;

    global.fetch = vi.fn(async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init as RequestInit & { duplex?: string };
      return new Response(JSON.stringify({ file: { id: "file-1" } }), {
        status: 201,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;

    await fileApi.uploadEncrypted(
      "vault-1",
      file,
      vaultDek,
      "test-token",
      "folder-1"
    );

    expect(capturedUrl).toBeDefined();
    const url = new URL(capturedUrl!);

    expect(url.pathname).toBe("/files/upload-encrypted");
    expect(url.searchParams.get("vaultId")).toBe("vault-1");
    expect(url.searchParams.get("folderId")).toBe("folder-1");
    // No plaintext `name` query param at all — the server must never
    // receive this file's real name, not even transiently in a URL.
    expect(url.searchParams.has("name")).toBe(false);
    expect(url.searchParams.get("encryptedName")).toBeTruthy();
    expect(url.searchParams.get("encryptedName")).not.toContain("hello");
    expect(url.searchParams.get("nameIv")).toBeTruthy();
    expect(url.searchParams.get("mimeType")).toBe("text/plain");
    expect(url.searchParams.get("encryptionVersion")).toBe("1");
    expect(url.searchParams.get("wrappedKeyCiphertext")).toBeTruthy();
    expect(url.searchParams.get("wrappedKeyIv")).toBeTruthy();

    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.duplex).toBe("half");

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/octet-stream");

    // The body is the ciphertext ReadableStream, never the raw File and
    // never a multipart FormData envelope.
    expect(capturedInit?.body).toBeInstanceOf(ReadableStream);
    expect(capturedInit?.body).not.toBeInstanceOf(FormData);
  });

  it("throws when the server responds with a non-2xx status", async () => {
    const vaultDek = await generateAesKey();
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });

    global.fetch = vi.fn(
      async () => new Response("", { status: 500 })
    ) as unknown as typeof fetch;

    await expect(
      fileApi.uploadEncrypted("vault-1", file, vaultDek, "token")
    ).rejects.toThrow("Upload failed");
  });
});

function mockErrorResponse(status: number, code: string, message = "error") {
  global.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: { code, message } }), {
        status,
        headers: { "Content-Type": "application/json" }
      })
  ) as unknown as typeof fetch;
}

describe("onSessionExpired", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fires every registered listener when a request gets a 401 INVALID_TOKEN response", async () => {
    mockErrorResponse(401, "INVALID_TOKEN", "Invalid or missing access token");

    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);

    await expect(authApi.me("stale-token")).rejects.toThrow();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does not fire for a 401 with a different code (e.g. a wrong-password UNAUTHORIZED)", async () => {
    mockErrorResponse(401, "UNAUTHORIZED", "Invalid username or password");

    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);

    await expect(authApi.login("someone", "wrong-password")).rejects.toThrow();

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("does not fire for a non-401 error", async () => {
    mockErrorResponse(500, "INTERNAL_ERROR");

    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);

    await expect(authApi.me("some-token")).rejects.toThrow();

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("stops notifying a listener after it unsubscribes", async () => {
    mockErrorResponse(401, "INVALID_TOKEN");

    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);
    unsubscribe();

    await expect(authApi.me("stale-token")).rejects.toThrow();

    expect(listener).not.toHaveBeenCalled();
  });

  it("still throws the ApiError for the caller even while notifying listeners", async () => {
    mockErrorResponse(401, "INVALID_TOKEN", "Invalid or missing access token");

    const unsubscribe = onSessionExpired(() => undefined);

    await expect(authApi.me("stale-token")).rejects.toMatchObject({
      status: 401,
      code: "INVALID_TOKEN"
    });

    unsubscribe();
  });
});
