"use client";

import * as React from "react";
import type { UserDTO } from "@vaultdrop/types";
import { authApi, ApiError } from "@/lib/api-client";

const STORAGE_KEY = "vaultdrop.session";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface StoredSession {
  user: UserDTO;
  accessToken: string;
}

interface AuthContextValue {
  status: AuthStatus;
  user: UserDTO | null;
  accessToken: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

function readStoredSession(): StoredSession | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.accessToken || !parsed.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredSession | null): void {
  if (typeof window === "undefined") {
    return;
  }
  if (session) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<AuthStatus>("loading");
  const [user, setUser] = React.useState<UserDTO | null>(null);
  const [accessToken, setAccessToken] = React.useState<string | null>(null);

  React.useEffect(() => {
    const stored = readStoredSession();
    if (!stored) {
      setStatus("unauthenticated");
      return;
    }

    // Re-validate the token against the server rather than trusting the
    // cached user blindly (covers expired/rotated secrets, deleted users).
    authApi
      .me(stored.accessToken)
      .then((result) => {
        setUser(result.user);
        setAccessToken(stored.accessToken);
        setStatus("authenticated");
      })
      .catch(() => {
        writeStoredSession(null);
        setStatus("unauthenticated");
      });
  }, []);

  const login = React.useCallback(async (username: string, password: string) => {
    const result = await authApi.login(username, password);
    writeStoredSession({ user: result.user, accessToken: result.accessToken });
    setUser(result.user);
    setAccessToken(result.accessToken);
    setStatus("authenticated");
  }, []);

  const register = React.useCallback(async (username: string, password: string) => {
    const result = await authApi.register(username, password);
    writeStoredSession({ user: result.user, accessToken: result.accessToken });
    setUser(result.user);
    setAccessToken(result.accessToken);
    setStatus("authenticated");
  }, []);

  const logout = React.useCallback(async () => {
    if (accessToken) {
      try {
        await authApi.logout(accessToken);
      } catch (error) {
        // A failed server-side logout call (e.g. token already expired)
        // should never prevent the client from clearing its own session.
        if (!(error instanceof ApiError)) {
          throw error;
        }
      }
    }
    writeStoredSession(null);
    setUser(null);
    setAccessToken(null);
    setStatus("unauthenticated");
  }, [accessToken]);

  const value = React.useMemo<AuthContextValue>(
    () => ({ status, user, accessToken, login, register, logout }),
    [status, user, accessToken, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
