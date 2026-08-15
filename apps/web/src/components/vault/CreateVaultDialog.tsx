"use client";

import { useState } from "react";
import type { RecoveryEnvelopeResponse } from "@vaultdrop/types";
import { ApiError, authApi, vaultApi } from "@/lib/api-client";
import { useAuth } from "@/components/providers/auth-provider";
import { useVaultKeys } from "@/components/providers/vault-key-provider";
import { createVaultEnvelope, createRecoveryEnvelope } from "@/lib/vault-keys";
import RecoveryKeyDialog from "./RecoveryKeyDialog";

interface CreateVaultDialogProps {
  onClose: () => void;
  onCreated: () => void;
}

interface GeneratedRecovery {
  recoveryKey: string;
  envelope: RecoveryEnvelopeResponse;
}

/**
 * Tracks a vault that was successfully created but whose recovery-key
 * enrollment hasn't succeeded yet. `generated` is `null` only in the rare
 * case `createRecoveryEnvelope` itself threw before producing anything
 * (nothing exists yet to retry with); once it has a value, Retry must
 * reuse it verbatim rather than generating a new recovery key — the vault
 * was already created and enrolling a second, different recovery key for
 * the same vault would just silently invalidate/replace whatever the user
 * already saw, exactly the kind of confusion this fix exists to prevent.
 */
interface PendingRecovery {
  vaultId: string;
  dek: CryptoKey;
  generated: GeneratedRecovery | null;
}

export default function CreateVaultDialog({
  onClose,
  onCreated,
}: CreateVaultDialogProps) {
  const { accessToken, user } = useAuth();
  const { setVaultKey } = useVaultKeys();

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [pendingRecovery, setPendingRecovery] = useState<PendingRecovery | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [skipAcknowledged, setSkipAcknowledged] = useState(false);

  /**
   * Submits an already-generated recovery envelope. Never generates a new
   * one — callers (both the initial attempt and Retry) are responsible
   * for reusing the same `generated` value so a failed-then-retried
   * enrollment ends up with exactly the recovery key the user is shown,
   * not a different one minted on a second attempt.
   */
  async function submitRecoveryEnrollment(
    vaultId: string,
    generated: GeneratedRecovery
  ): Promise<void> {
    if (!accessToken) return;

    try {
      await vaultApi.enrollRecoveryKey(vaultId, generated.envelope, accessToken);
      setPendingRecovery(null);
      setRecoveryKey(generated.recoveryKey);
    } catch {
      // Left in `pendingRecovery` (already set by the caller before this
      // runs) so the retry/skip UI can offer resending the exact same
      // envelope rather than losing it.
    }
  }

  /**
   * Best-effort: the vault is already fully created and usable via
   * password even if recovery enrollment fails here (see the password
   * verification step in `handleCreate`, which runs first specifically so
   * that "usable via password" is actually true). A failure here must
   * never roll back or block vault creation, but it also must never be
   * silent — `pendingRecovery` drives a visible retry/skip UI instead of
   * closing the dialog.
   */
  async function attemptRecoveryEnrollment(vaultId: string, dek: CryptoKey): Promise<void> {
    let generated: GeneratedRecovery;

    try {
      generated = await createRecoveryEnvelope(dek);
    } catch {
      setPendingRecovery({ vaultId, dek, generated: null });
      return;
    }

    setPendingRecovery({ vaultId, dek, generated });
    await submitRecoveryEnrollment(vaultId, generated);
  }

  async function handleCreate() {
    if (!accessToken || !user) {
      setError("You are not logged in.");
      return;
    }

    if (!name.trim()) {
      setError("Please enter a vault name.");
      return;
    }

    if (!password) {
      setError("Please enter your account password to encrypt this vault.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      // Verify the typed string is really the account's current password
      // *before* deriving any key material from it — otherwise a mistyped
      // password here would silently produce a vault that can never be
      // unlocked with the user's real password again. Reuses the exact
      // same authApi.login-based check UnlockVaultGate's restore-password
      // flow already relies on: the call only verifies (a fresh token is
      // returned but discarded, never stored), so it never touches the
      // active session, and no vault crypto or vault creation happens
      // unless this succeeds.
      try {
        await authApi.login(user.username, password);
      } catch {
        setError("Incorrect password.");
        return;
      }

      // Generated and wrapped entirely client-side, from the exact same
      // `password` value just verified above — only the resulting
      // ciphertext/KDF-param envelope (never the password, KEK, or DEK
      // itself) is sent to the server as part of vault creation.
      const { dek, envelope } = await createVaultEnvelope(password);

      const { vault } = await vaultApi.create(
        name.trim(),
        accessToken,
        envelope
      );

      // The DEK was just generated in this tab, so hold it as already
      // unlocked rather than forcing an immediate re-prompt.
      setVaultKey(vault.id, dek);

      await attemptRecoveryEnrollment(vault.id, dek);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRetryRecoveryEnrollment() {
    if (!pendingRecovery) return;

    try {
      setRetrying(true);
      setError("");

      if (pendingRecovery.generated) {
        await submitRecoveryEnrollment(pendingRecovery.vaultId, pendingRecovery.generated);
      } else {
        // Nothing was ever generated to reuse (createRecoveryEnvelope
        // itself failed last time) — this is the only case where trying
        // again legitimately calls it again, since there is no existing
        // envelope to lose.
        await attemptRecoveryEnrollment(pendingRecovery.vaultId, pendingRecovery.dek);
      }
    } finally {
      setRetrying(false);
    }
  }

  function handleSkipRecovery() {
    if (!skipAcknowledged) return;
    setPendingRecovery(null);
    onCreated();
    onClose();
  }

  function handleRecoveryKeySaved() {
    setRecoveryKey(null);
    onCreated();
    onClose();
  }

  if (recoveryKey) {
    return (
      <RecoveryKeyDialog recoveryKey={recoveryKey} onDone={handleRecoveryKeySaved} />
    );
  }

  if (pendingRecovery) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
          <h2 className="text-xl font-bold text-gray-900">
            Couldn&rsquo;t set up a recovery key
          </h2>

          <p className="mt-2 text-sm text-gray-500">
            Your vault was created and is ready to use with your password.
            But we couldn&rsquo;t save a recovery key for it yet — without
            one, if you ever forget your password there is no way for
            anyone, including us, to recover this vault&rsquo;s files.
          </p>

          <button
            onClick={handleRetryRecoveryEnrollment}
            disabled={retrying}
            className="mt-5 w-full rounded-lg bg-violet-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {retrying ? "Retrying..." : "Retry"}
          </button>

          <label className="mt-5 flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={skipAcknowledged}
              onChange={(e) => setSkipAcknowledged(e.target.checked)}
              disabled={retrying}
              className="mt-0.5"
            />
            I understand this vault has no recovery key, and I could lose
            access to it permanently if I ever forget my password.
          </label>

          <button
            onClick={handleSkipRecovery}
            disabled={!skipAcknowledged || retrying}
            className="mt-3 w-full rounded-lg border px-4 py-2 disabled:opacity-50"
          >
            Continue without a recovery key
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
      >
        <h2 className="text-2xl font-bold">
          Create New Vault
        </h2>

        <p className="mt-2 text-sm text-gray-500">
          Give your vault a name.
        </p>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleCreate();
            }
          }}
          type="text"
          placeholder="Personal Vault"
          disabled={loading}
          className="mt-5 w-full rounded-lg border p-3 outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
        />

        <p className="mt-4 text-sm text-gray-500">
          Confirm your account password to encrypt it. This never leaves
          your browser.
        </p>

        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleCreate();
            }
          }}
          type="password"
          autoComplete="current-password"
          placeholder="Account password"
          disabled={loading}
          className="mt-2 w-full rounded-lg border p-3 outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
        />

        {error && (
          <p className="mt-3 text-sm text-red-500">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border px-4 py-2 disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            onClick={handleCreate}
            disabled={loading}
            className="rounded-lg bg-violet-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
