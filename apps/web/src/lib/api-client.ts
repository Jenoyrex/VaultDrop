import { loadWebEnv } from "@vaultdrop/config";
import type { AuthResponse, UserDTO } from "@vaultdrop/types";

const env = loadWebEnv({ NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL });

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

async function request<T>(
  path: string,
  init?: RequestInit & { token?: string | null }
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    headers
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = (await response.json().catch(() => null)) as T | ApiErrorBody | null;

  if (!response.ok) {
    const body = data as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? "UNKNOWN_ERROR",
      body?.error?.message ?? "Something went wrong. Please try again."
    );
  }

  return data as T;
}

export interface CheckUsernameResponse {
  exists: boolean;
}

export const authApi = {
  checkUsername(username: string): Promise<CheckUsernameResponse> {
    return request<CheckUsernameResponse>(
      `/auth/check-username?username=${encodeURIComponent(username)}`
    );
  },

  register(username: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
  },

  login(username: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
  },

  logout(token: string): Promise<void> {
    return request<void>("/auth/logout", { method: "POST", token });
  },

  me(token: string): Promise<{ user: UserDTO }> {
    return request<{ user: UserDTO }>("/auth/me", { token });
  }
};
