"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import type { VaultDTO } from "@vaultdrop/types";
import { useAuth } from "@/components/providers/auth-provider";
import { ApiError, authApi, vaultApi } from "@/lib/api-client";
import {
  CorruptedVaultError,
  IncorrectPasswordError,
  hasEncryptionEnvelope,
  prepareVaultRewrapsForPasswordChange,
  unwrapVaultDek
} from "@/lib/vault-keys";

interface ChangePasswordDialogProps {
  onClose: () => void;
}

type VaultCheckStatus = "checking" | "ready" | "failed";

/**
 * Changing the account password re-wraps every encrypted vault's DEK for
 * the new password, atomically with the password itself, via a single
 * `PUT /auth/password` request (see `AuthService.changePassword`). Every
 * encrypted vault must be reachable with the *current* password for this
 * to succeed — the live checklist below verifies each one as soon as the
 * user finishes typing it, and the submit button stays disabled until
 * every vault reads "Ready". This isn't a separate "unlock each vault
 * first" step: it reuses the same password already being typed into this
 * form, since requiring it twice would add no security and worse UX.
 */
export default function ChangePasswordDialog({ onClose }: ChangePasswordDialogProps) {
  const { accessToken } = useAuth();

  const [encryptedVaults, setEncryptedVaults] = useState<VaultDTO[] | null>(null);
  const [vaultStatuses, setVaultStatuses] = useState<Record<string, VaultCheckStatus>>({});
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    vaultApi
      .list(accessToken)
      .then(({ vaults }) => {
        setEncryptedVaults(vaults.filter(hasEncryptionEnvelope));
      })
      .catch(() => setEncryptedVaults([]));
  }, [accessToken]);

  // Live per-vault verification: attempts to unwrap every encrypted
  // vault with whatever the user has currently typed as their current
  // password, debounced so it doesn't re-run on every keystroke. This is
  // a UX signal only — the real unwrap/rewrap happens fresh at submit
  // time in `handleSubmit`, so editing the password field after this
  // check can never leave stale key material lying around.
  useEffect(() => {
    if (!encryptedVaults || encryptedVaults.length === 0 || !currentPassword) {
      setVaultStatuses({});
      return;
    }

    let cancelled = false;
    setVaultStatuses(
      Object.fromEntries(encryptedVaults.map((vault) => [vault.id, "checking" as const]))
    );

    const timer = setTimeout(async () => {
      const results = await Promise.allSettled(
        encryptedVaults.map((vault) => unwrapVaultDek(vault, currentPassword))
      );
      if (cancelled) return;

      const next: Record<string, VaultCheckStatus> = {};
      encryptedVaults.forEach((vault, index) => {
        next[vault.id] = results[index]?.status === "fulfilled" ? "ready" : "failed";
      });
      setVaultStatuses(next);
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [encryptedVaults, currentPassword]);

  const statuses = Object.values(vaultStatuses);
  const allChecked =
    encryptedVaults !== null &&
    (encryptedVaults.length === 0 ||
      (statuses.length === encryptedVaults.length && statuses.every((s) => s === "ready")));
  const allFailed = statuses.length > 0 && statuses.every((s) => s === "failed");

  const canSubmit =
    !submitting &&
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    allChecked;

  async function handleSubmit() {
    if (!accessToken || !encryptedVaults) return;

    try {
      setSubmitting(true);
      setError("");

      const rewraps = await prepareVaultRewrapsForPasswordChange(
        encryptedVaults,
        currentPassword,
        newPassword
      );

      await authApi.changePassword(currentPassword, newPassword, rewraps, accessToken);

      setDone(true);
    } catch (err) {
      if (err instanceof IncorrectPasswordError) {
        setError("Current password is incorrect.");
      } else if (err instanceof CorruptedVaultError) {
        setError(
          `"${err.vaultName}" couldn't be read with your current password — its data may be corrupted. Use its recovery key to fix it, then try again.`
        );
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow-2xl">
          <h2 className="text-xl font-bold text-gray-900">Password changed</h2>
          <p className="mt-2 text-sm text-gray-500">
            Use your new password next time you log in or unlock a vault.
          </p>
          <button
            onClick={onClose}
            className="mt-6 rounded-lg bg-violet-600 px-4 py-2 text-white"
          >
            Done
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
        <div className="flex items-center gap-2 text-gray-900">
          <KeyRound className="h-5 w-5" />
          <h2 className="text-xl font-bold">Change account password</h2>
        </div>

        <p className="mt-2 text-sm text-gray-500">
          Your account password also protects every encrypted vault. Changing it re-wraps each
          vault&rsquo;s key for the new password — your files are never re-encrypted or sent
          anywhere.
        </p>

        <input
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          type="password"
          autoComplete="current-password"
          placeholder="Current password"
          className="mt-4 w-full rounded-lg border p-3 outline-none focus:ring-2 focus:ring-violet-500"
        />

        {encryptedVaults && encryptedVaults.length > 0 && currentPassword && (
          <div className="mt-3 space-y-1 rounded-lg border bg-gray-50 p-3 text-sm">
            {encryptedVaults.map((vault) => {
              const status = vaultStatuses[vault.id] ?? "checking";
              return (
                <div key={vault.id} className="flex items-center justify-between">
                  <span className="text-gray-700">{vault.name}</span>
                  {status === "checking" && <span className="text-gray-400">Checking…</span>}
                  {status === "ready" && <span className="text-green-600">Ready ✓</span>}
                  {status === "failed" && !allFailed && (
                    <span className="text-red-600">Can&rsquo;t unlock — recover this vault first</span>
                  )}
                </div>
              );
            })}
            {allFailed && (
              <p className="pt-1 font-medium text-red-600">Current password is incorrect.</p>
            )}
          </div>
        )}

        <input
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          type="password"
          autoComplete="new-password"
          placeholder="New password"
          className="mt-3 w-full rounded-lg border p-3 outline-none focus:ring-2 focus:ring-violet-500"
        />

        <input
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          type="password"
          autoComplete="new-password"
          placeholder="Confirm new password"
          className="mt-3 w-full rounded-lg border p-3 outline-none focus:ring-2 focus:ring-violet-500"
        />

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border px-4 py-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Change Password
          </button>
        </div>
      </div>
    </div>
  );
}
