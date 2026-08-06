"use client";

import { useState } from "react";
import { ApiError, vaultApi } from "@/lib/api-client";
import { useAuth } from "@/components/providers/auth-provider";

interface CreateVaultDialogProps {
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateVaultDialog({
  onClose,
  onCreated,
}: CreateVaultDialogProps) {
  const { accessToken } = useAuth();

  const [name, setName] = useState("");
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

    try {
      setLoading(true);
      setError("");

      await vaultApi.create(name.trim(), accessToken);

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