"use client";

import { useState } from "react";

interface CreateFolderDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}

export default function CreateFolderDialog({
  open,
  onClose,
  onCreate
}: CreateFolderDialogProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleCreate() {
    if (!name.trim()) return;

    try {
      setLoading(true);

      await onCreate(name.trim());

      setName("");

      onClose();

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
          New Folder
        </h2>

        <p className="mt-2 text-muted-foreground">
          Enter a folder name.
        </p>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Photos"
          className="mt-5 w-full rounded-lg border bg-background p-3 outline-none"
        />

        <div className="mt-6 flex justify-end gap-3">

          <button
            onClick={onClose}
            className="rounded-lg border px-4 py-2"
          >
            Cancel
          </button>

          <button
            disabled={loading}
            onClick={handleCreate}
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
          >
            {loading ? "Creating..." : "Create"}
          </button>

        </div>

      </div>
    </div>
  );
}