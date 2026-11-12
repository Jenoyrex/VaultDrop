// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./auth-provider";

const { meMock, loginMock, logoutMock } = vi.hoisted(() => ({
  meMock: vi.fn(),
  loginMock: vi.fn(),
  logoutMock: vi.fn()
}));

vi.mock("@/lib/api-client", () => ({
  authApi: { me: meMock, login: loginMock, register: vi.fn(), logout: logoutMock },
  onSessionExpired: () => () => undefined,
  ApiError: class ApiError extends Error {}
}));

const USER = { id: "u1", username: "alice", createdAt: "2026-01-01T00:00:00.000Z" };

let api: ReturnType<typeof useAuth> | undefined;
function Probe() {
  api = useAuth();
  return <span data-testid="status">{api.status}</span>;
}

/** Minimal Storage, installed per test: newer Node versions ship their own
 * global `localStorage` that shadows jsdom's and is unusable without a
 * backing file, so the test provides one explicitly. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v))
  };
}

describe("AuthProvider (cookie sessions)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of ["localStorage", "sessionStorage"] as const) {
      Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
    }
  });
  afterEach(() => {
    cleanup();
    api = undefined;
  });

  it("restores the session by asking the server, and removes the legacy localStorage token", async () => {
    window.localStorage.setItem("vaultdrop.session", JSON.stringify({ user: USER, accessToken: "old.jwt.value" }));
    meMock.mockResolvedValue({ user: USER });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(meMock).toHaveBeenCalledWith();
    expect(window.localStorage.getItem("vaultdrop.session")).toBeNull();
  });

  it("stores nothing in web storage on login or logout and exposes no token", async () => {
    meMock.mockRejectedValue(new Error("401"));
    loginMock.mockResolvedValue({ user: USER });
    logoutMock.mockResolvedValue(undefined);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));

    await act(() => api!.login("alice", "pw-long-enough"));
    expect(screen.getByTestId("status").textContent).toBe("authenticated");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(Object.keys(api!)).not.toContain("accessToken");

    await act(() => api!.logout());
    expect(logoutMock).toHaveBeenCalledWith();
    expect(screen.getByTestId("status").textContent).toBe("unauthenticated");
  });
});
