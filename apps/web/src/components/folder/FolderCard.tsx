"use client";

import { useState } from "react";
import { Folder, Pencil } from "lucide-react";

import { folderApi, type FolderDTO } from "@/lib/api-client";
import { useAuth } from "@/components/providers/auth-provider";
import { useVaultKeys } from "@/components/providers/vault-key-provider";
import { useDisplayName } from "@/hooks/useDisplayName";
import { encryptText } from "@/lib/crypto";
import RenameDialog from "@/components/shared/RenameDialog";

interface FolderCardProps {
  folder: FolderDTO;
  onClick: (displayName: string) => void;
  onRenamed: () => void;
  pathLabel?: string;
}

export default function FolderCard({
  folder,
  onClick,
  onRenamed,
  pathLabel
}: FolderCardProps) {
  const { accessToken } = useAuth();
  const { getVaultKey } = useVaultKeys();

  const [renameOpen, setRenameOpen] = useState(false);

  // Only relevant for an encrypted folder — this tab's in-memory unwrapped
  // vault DEK, if the vault is currently unlocked. `FolderCard` is only
  // ever rendered once its vault's contents are shown, which the vault
  // page already gates behind `UnlockVaultGate`, so this is expected to
  // be defined whenever `folder.encrypted` is true.
  const vaultDek = folder.encrypted ? getVaultKey(folder.vaultId) : undefined;

  const { displayName, error: nameError } = useDisplayName(folder, vaultDek);
  const nameForDisplay = displayName ?? (nameError ? "Unable to decrypt name" : "Loading…");

  async function handleRename(newName: string) {
    if (!accessToken) return;

    if (folder.encrypted) {
      if (!vaultDek) {
        alert("Vault is locked. Unlock it and try again.");
        return;
      }

      const { ciphertext, iv } = await encryptText(newName, vaultDek);

      await folderApi.rename(
        folder.id,
        { encryptedName: ciphertext, nameIv: iv },
        accessToken
      );
    } else {
      await folderApi.rename(
        folder.id,
        { name: newName },
        accessToken
      );
    }

    onRenamed();
  }

  return (
    <div className="group relative rounded-xl border bg-card transition hover:shadow-xl hover:border-primary">

      <button
        onClick={() => onClick(nameForDisplay)}
        className="flex w-full flex-col items-center justify-center p-6"
      >
        <Folder
          className="mb-4 h-16 w-16 text-yellow-500"
          fill="#facc15"
        />

        <h3 className="max-w-full truncate text-lg font-semibold">
          {nameForDisplay}
        </h3>

        {pathLabel && (
          <p className="mt-1 max-w-full truncate text-xs text-muted-foreground">
            {pathLabel}
          </p>
        )}
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          setRenameOpen(true);
        }}
        className="absolute right-3 top-3 rounded-lg border bg-card p-2 opacity-0 transition hover:bg-accent group-hover:opacity-100"
      >
        <Pencil className="h-4 w-4" />
      </button>

      <RenameDialog
        open={renameOpen}
        title="Rename Folder"
        initialName={nameForDisplay}
        onClose={() => setRenameOpen(false)}
        onRename={handleRename}
      />

    </div>
  );
}