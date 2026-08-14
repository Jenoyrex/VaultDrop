"use client";

import { useState } from "react";
import { Lock, Loader2, KeyRound } from "lucide-react";
import type { VaultDTO } from "@vaultdrop/types";
import { useVaultKeys } from "@/components/providers/vault-key-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { ApiError, authApi, vaultApi } from "@/lib/api-client";
import { unwrapVaultDekWithRecoveryKey, rewrapVaultDekWithPassword } from "@/lib/vault-keys";

interface UnlockVaultGateProps {
  vault: VaultDTO;
  onUnlocked: () => void;
}

type Mode = "password" | "recovery" | "restore";

/**
 * Shown instead of a vault's contents whenever the vault has a
 * zero-knowledge encryption envelope but this browser tab doesn't
 * currently hold its unwrapped DEK in memory (e.g. right after login,
 * or after a page refresh).
 *
 * Two independent unlock paths:
 *  - Password (default): derives the KEK and unwraps the DEK locally.
 *    Never sent to the server.
 *  - Recovery key ("forgot your password?"): fetches this vault's
 *    recovery envelope and unwraps the DEK with a user-supplied recovery
 *    key instead — no password involved at all. On success, before the
 *    vault actually unlocks, offers an optional "restore password
 *    unlock" step that re-wraps the recovered DEK under the user's
 *    *current* account password (proven via a real login call, never an
 *    arbitrary new one) so normal password unlock works again next time.
 *    Deliberately does not call `setVaultKey`/`onUnlocked` until that
 *    choice is made — doing so earlier would let the parent page's
 *    `needsUnlock` flip false and unmount this component mid-flow.
 */
export default function UnlockVaultGate({
  vault,
  onUnlocked
}: UnlockVaultGateProps) {
  const { unlockVault, setVaultKey } = useVaultKeys();
  const { accessToken, user } = useAuth();

  const [mode, setMode] = useState<Mode>("password");
  const [password, setPassword] = useState("");
  const [recoveryKeyInput, setRecoveryKeyInput] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [recoveredDek, setRecoveredDek] = useState<CryptoKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
  }

  async function handlePasswordUnlock() {
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

  async function handleRecover() {
    if (!recoveryKeyInput.trim()) {
      setError("Please enter your recovery key.");
      return;
    }
    if (!accessToken) {
      setError("You are not logged in.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const envelope = await vaultApi.getRecoveryEnvelope(vault.id, accessToken);
      const dek = await unwrapVaultDekWithRecoveryKey(envelope, recoveryKeyInput.trim());

      // Held locally only — deliberately not put into VaultKeyProvider
      // yet, so this gate stays mounted for the optional restore step.
      setRecoveredDek(dek);
      switchMode("restore");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? "This vault has no recovery key set up."
          : "Invalid recovery key."
      );
    } finally {
      setLoading(false);
    }
  }

  function finishRecovery(dek: CryptoKey) {
    setVaultKey(vault.id, dek);
    onUnlocked();
  }

  async function handleRestorePassword() {
    if (!recoveredDek || !accessToken || !user) return;

    if (!restorePassword) {
      setError("Please enter your current account password.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      // Proves `restorePassword` really is the current account password
      // by running it through the real login check — this never invents
      // a separate, vault-only password. Only on success is it used to
      // re-derive this vault's KEK.
      await authApi.login(user.username, restorePassword);

      const envelope = await rewrapVaultDekWithPassword(recoveredDek, restorePassword);
      await vaultApi.rewrapEncryption(vault.id, envelope, accessToken);

      finishRecovery(recoveredDek);
    } catch {
      setError("That doesn't match your current account password.");
    } finally {
      setLoading(false);
    }
  }

  function handleSkipRestore() {
    if (!recoveredDek) return;
    finishRecovery(recoveredDek);
  }

  if (mode === "restore") {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <KeyRound className="h-8 w-8" />
        </div>

        <h2 className="text-xl font-semibold">Vault recovered</h2>

        <p className="max-w-sm text-sm text-muted-foreground">
          Your files are accessible for this session. Enter your current
          account password to also restore normal password unlock for next
          time — or skip this and just continue for now.
        </p>

        <div className="flex w-full max-w-xs flex-col gap-2">
          <input
            value={restorePassword}
            onChange={(e) => setRestorePassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleRestorePassword();
              }
            }}
            type="password"
            autoComplete="current-password"
            autoFocus
            placeholder="Current account password"
            className="w-full rounded-lg border bg-background p-3 outline-none focus:ring-2 focus:ring-primary"
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            onClick={handleRestorePassword}
            disabled={loading}
            className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-primary-foreground disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Restoring...
              </>
            ) : (
              "Restore password unlock"
            )}
          </button>

          <button
            onClick={handleSkipRestore}
            disabled={loading}
            className="text-sm text-muted-foreground hover:underline disabled:opacity-50"
          >
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  if (mode === "recovery") {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <KeyRound className="h-8 w-8" />
        </div>

        <h2 className="text-xl font-semibold">Use your recovery key</h2>

        <p className="max-w-sm text-sm text-muted-foreground">
          Enter the recovery key you saved when this vault was set up. It
          works without your password.
        </p>

        <div className="flex w-full max-w-xs flex-col gap-2">
          <input
            value={recoveryKeyInput}
            onChange={(e) => setRecoveryKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleRecover();
              }
            }}
            type="text"
            autoFocus
            placeholder="VDR1-XXXX-XXXX-..."
            className="w-full rounded-lg border bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-primary"
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            onClick={handleRecover}
            disabled={loading}
            className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-primary-foreground disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Recovering...
              </>
            ) : (
              "Recover vault"
            )}
          </button>

          <button
            onClick={() => switchMode("password")}
            disabled={loading}
            className="text-sm text-muted-foreground hover:underline disabled:opacity-50"
          >
            Back to password unlock
          </button>
        </div>
      </div>
    );
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
              handlePasswordUnlock();
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
          onClick={handlePasswordUnlock}
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

        {vault.hasRecoveryKey && (
          <button
            onClick={() => switchMode("recovery")}
            disabled={loading}
            className="text-sm text-muted-foreground hover:underline disabled:opacity-50"
          >
            Forgot your password? Use your recovery key
          </button>
        )}
      </div>
    </div>
  );
}
