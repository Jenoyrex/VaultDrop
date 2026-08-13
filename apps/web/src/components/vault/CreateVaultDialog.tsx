"use client";

import { useState } from "react";
import { ApiError, vaultApi } from "@/lib/api-client";
import { useAuth } from "@/components/providers/auth-provider";
import { useVaultKeys } from "@/components/providers/vault-key-provider";
import { createVaultEnvelope } from "@/lib/vault-keys";

interface CreateVaultDialogProps {
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateVaultDialog({
  onClose,
  onCreated,
}: CreateVaultDialogProps) {
  const { accessToken } = useAuth();
  const { setVaultKey } = useVaultKeys();

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    if (!accessToken) {
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

      // Generated and wrapped entirely client-side — only the resulting
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

      onCreated();
      onClose();
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
          className="mt-5 w-full rounded-lg border p-3 outline-none focus:ring-2 focus:ring-violet-500"
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
          className="mt-2 w-full rounded-lg border p-3 outline-none focus:ring-2 focus:ring-violet-500"
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