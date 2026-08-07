"use client";

import { useEffect, useState } from "react";

interface RenameDialogProps {
  open: boolean;
  title: string;
  initialName: string;
  extension?: string;
  onClose: () => void;
  onRename: (newName: string) => Promise<void>;
}

export default function RenameDialog({
  open,
  title,
  initialName,
  extension,
  onClose,
  onRename
}: RenameDialogProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setError(null);
    }
  }, [open, initialName]);

  if (!open) return null;

  async function handleRename() {
    const trimmed = name.trim();

    if (!trimmed) {
      setError("Name cannot be empty.");
      return;
    }

    const finalName = extension
      ? `${trimmed}${extension}`
      : trimmed;

    if (finalName === initialName) {
      onClose();
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await onRename(finalName);

      onClose();
    } catch (err) {
      console.error(err);
      setError("Rename failed. That name may already be in use.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-2xl font-bold">
          {title}
        </h2>

        <p className="mt-2 text-muted-foreground">
          Enter a new name.
        </p>

        <div className="mt-5 flex items-center gap-2">

          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            autoFocus
            className="w-full rounded-lg border bg-background p-3 outline-none"
          />

          {extension && (
            <span className="whitespace-nowrap text-muted-foreground">
              {extension}
            </span>
          )}

        </div>

        {error && (
          <p className="mt-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">

          <button
            onClick={onClose}
            className="rounded-lg border px-4 py-2"
          >
            Cancel
          </button>

          <button
            disabled={loading}
            onClick={handleRename}
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
          >
            {loading ? "Renaming..." : "Rename"}
          </button>

        </div>

      </div>
    </div>
  );
}