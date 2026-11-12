"use client";

import * as React from "react";
import type { UserDTO } from "@vaultdrop/types";
import { authApi, onSessionExpired, ApiError } from "@/lib/api-client";

/**
 * Key the pre-cookie version of this app stored `{ user, accessToken }`
 * under. Nothing reads it any more; it is removed on load so a token left
 * behind by an old version does not sit in localStorage indefinitely.
 */
const LEGACY_STORAGE_KEY = "vaultdrop.session";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

/**
 * The session token is an httpOnly cookie set by the API: this provider
 * never sees it and keeps no copy anywhere. "Am I signed in?" is answered
 * by asking the server (`/auth/me`), which reads the cookie itself.
 */
interface AuthContextValue {
  status: AuthStatus;
  user: UserDTO | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<AuthStatus>("loading");
  const [user, setUser] = React.useState<UserDTO | null>(null);

  React.useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Storage can be unavailable (privacy mode); nothing to clean up then.
    }

    authApi
      .me()
      .then((result) => {
        setUser(result.user);
        setStatus("authenticated");
      })
      .catch(() => {
        setStatus("unauthenticated");
      });
  }, []);

  const login = React.useCallback(async (username: string, password: string) => {
    const result = await authApi.login(username, password);
    setUser(result.user);
    setStatus("authenticated");
  }, []);

  const register = React.useCallback(async (username: string, password: string) => {
    const result = await authApi.register(username, password);
    setUser(result.user);
    setStatus("authenticated");
  }, []);

  // Shared by an explicit logout and a discovered session-expiry — both
  // end at the exact same local state.
  const clearSession = React.useCallback(() => {
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const logout = React.useCallback(async () => {
    try {
      // The server revokes the token (tokenVersion bump) and clears the
      // cookie; JavaScript cannot clear an httpOnly cookie itself.
      await authApi.logout();
    } catch (error) {
      // A failed server-side logout call should never prevent the client
      // from clearing its own session state.
      if (!(error instanceof ApiError)) {
        throw error;
      }
    }
    clearSession();
  }, [clearSession]);

  // Centralized session-expiry handling: any API call anywhere in the app
  // that discovers the session itself is invalid/expired/revoked (see
  // `onSessionExpired` in api-client.ts) lands here, once. This reuses the
  // exact same `status` transition as an explicit logout, so
  // `DashboardLayout`'s redirect-to-/auth and `VaultKeyProvider`'s
  // clear-all-unlocked-DEKs effect (both keyed off `status`) fire the same
  // way for either path.
  React.useEffect(() => {
    return onSessionExpired(() => {
      clearSession();
    });
  }, [clearSession]);

  const value = React.useMemo<AuthContextValue>(
    () => ({ status, user, login, register, logout }),
    [status, user, login, register, logout]
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
