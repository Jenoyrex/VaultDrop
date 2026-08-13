"use client";

import { useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import type { VaultDTO } from "@vaultdrop/types";
import { useVaultKeys } from "@/components/providers/vault-key-provider";

interface UnlockVaultGateProps {
  vault: VaultDTO;
  onUnlocked: () => void;
}

/**
 * Shown instead of a vault's contents whenever the vault has a
 * zero-knowledge encryption envelope but this browser tab doesn't
 * currently hold its unwrapped DEK in memory (e.g. right after login,
 * or after a page refresh). The password entered here is used only to
 * derive the KEK and unwrap the DEK locally — it is never sent to the
 * server, and neither the password nor the resulting keys are persisted
 * anywhere.
 */
export default function UnlockVaultGate({
  vault,
  onUnlocked
}: UnlockVaultGateProps) {
  const { unlockVault } = useVaultKeys();

  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleUnlock() {
    if (!password) {
      setError("Please enter your account password.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      await unlockVault(vault, password);
      onUnlocked();
    } catch {
      setError("Incorrect password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Lock className="h-8 w-8" />
      </div>

      <h2 className="text-xl font-semibold">Unlock this vault</h2>

      <p className="max-w-sm text-sm text-muted-foreground">
        This vault is encrypted. Enter your account password to unlock it
        for this session — it stays in your browser and is never sent to
        the server.
      </p>

      <div className="flex w-full max-w-xs flex-col gap-2">
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleUnlock();
            }
          }}
          type="password"
          autoComplete="current-password"
          autoFocus
          placeholder="Account password"
          className="w-full rounded-lg border bg-background p-3 outline-none focus:ring-2 focus:ring-primary"
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          onClick={handleUnlock}
          disabled={loading}
          className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-primary-foreground disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Unlocking...
            </>
          ) : (
            "Unlock"
          )}
        </button>
      </div>
    </div>
  );
}
