"use client";

import { useState } from "react";
import { Folder, Pencil } from "lucide-react";

import { folderApi, type FolderDTO } from "@/lib/api-client";
import { useAuth } from "@/components/providers/auth-provider";
import RenameDialog from "@/components/shared/RenameDialog";

interface FolderCardProps {
  folder: FolderDTO;
  onClick: () => void;
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

  const [renameOpen, setRenameOpen] = useState(false);

  async function handleRename(newName: string) {
    if (!accessToken) return;

    await folderApi.rename(
      folder.id,
      newName,
      accessToken
    );

    onRenamed();
  }

  return (
    <div className="group relative rounded-xl border bg-card transition hover:shadow-xl hover:border-primary">

      <button
        onClick={onClick}
        className="flex w-full flex-col items-center justify-center p-6"
      >
        <Folder
          className="mb-4 h-16 w-16 text-yellow-500"
          fill="#facc15"
        />

        <h3 className="max-w-full truncate text-lg font-semibold">
          {folder.name}
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
        initialName={folder.name}
        onClose={() => setRenameOpen(false)}
        onRename={handleRename}
      />

    </div>
  );
}