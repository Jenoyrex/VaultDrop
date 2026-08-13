"use client";

import * as React from "react";
import type { VaultDTO } from "@vaultdrop/types";
import { unwrapVaultDek } from "@/lib/vault-keys";
import { useAuth } from "@/components/providers/auth-provider";

interface VaultKeyContextValue {
  /** Returns the vault's unwrapped DEK if it's currently unlocked in this tab. */
  getVaultKey: (vaultId: string) => CryptoKey | undefined;
  isUnlocked: (vaultId: string) => boolean;
  /**
   * Derives the KEK from `password` using the vault's stored KDF params
   * and unwraps its DEK, holding the result only in memory. Throws if
   * the password is wrong (or the envelope is missing/tampered) — the
   * caller is expected to catch this and show an "incorrect password"
   * message; nothing is sent to the server as part of this call.
   */
  unlockVault: (vault: VaultDTO, password: string) => Promise<void>;
  /** Stores an already-unwrapped DEK directly (used right after creating
   * a new encrypted vault, where the DEK was just generated in-browser
   * and there's no need to re-derive it from the password). */
  setVaultKey: (vaultId: string, dek: CryptoKey) => void;
  lockVault: (vaultId: string) => void;
  lockAll: () => void;
}

const VaultKeyContext = React.createContext<VaultKeyContextValue | undefined>(
  undefined
);

export function VaultKeyProvider({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();

  // In-memory only: a plain Map held in a ref, never written to
  // localStorage/sessionStorage/IndexedDB. It's lost on refresh, tab
  // close, or logout by design — that's the point of "unlocked only in
  // browser memory."
  const keysRef = React.useRef<Map<string, CryptoKey>>(new Map());
  // The counter itself is never read directly — it exists so `value`
  // below gets a new identity on every lock/unlock, which is what
  // actually propagates the change through context. Without it, `value`
  // stays reference-equal (its own deps are all stable useCallbacks) and
  // consumers like the vault-unlock gate never re-render, even though
  // `keysRef` did change underneath them.
  const [version, forceRender] = React.useReducer((n: number) => n + 1, 0);

  const lockAll = React.useCallback(() => {
    if (keysRef.current.size === 0) return;
    keysRef.current.clear();
    forceRender();
  }, []);

  // Logging out must drop every unlocked DEK immediately — the account
  // password that unlocked them is gone from memory anyway, but this
  // makes the invariant explicit rather than incidental.
  React.useEffect(() => {
    if (status === "unauthenticated") {
      lockAll();
    }
  }, [status, lockAll]);

  const getVaultKey = React.useCallback(
    (vaultId: string) => keysRef.current.get(vaultId),
    []
  );

  const isUnlocked = React.useCallback(
    (vaultId: string) => keysRef.current.has(vaultId),
    []
  );

  const setVaultKey = React.useCallback((vaultId: string, dek: CryptoKey) => {
    keysRef.current.set(vaultId, dek);
    forceRender();
  }, []);

  const unlockVault = React.useCallback(
    async (vault: VaultDTO, password: string) => {
      const dek = await unwrapVaultDek(vault, password);
      keysRef.current.set(vault.id, dek);
      forceRender();
    },
    []
  );

  const lockVault = React.useCallback((vaultId: string) => {
    if (!keysRef.current.delete(vaultId)) return;
    forceRender();
  }, []);

  const value = React.useMemo<VaultKeyContextValue>(
    () => ({
      getVaultKey,
      isUnlocked,
      unlockVault,
      setVaultKey,
      lockVault,
      lockAll
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is
    // intentionally a dep even though it's unused in the body: see comment
    // on its declaration above.
    [getVaultKey, isUnlocked, unlockVault, setVaultKey, lockVault, lockAll, version]
  );

  return (
    <VaultKeyContext.Provider value={value}>
      {children}
    </VaultKeyContext.Provider>
  );
}

export function useVaultKeys(): VaultKeyContextValue {
  const context = React.useContext(VaultKeyContext);
  if (!context) {
    throw new Error("useVaultKeys must be used within a VaultKeyProvider");
  }
  return context;
}
