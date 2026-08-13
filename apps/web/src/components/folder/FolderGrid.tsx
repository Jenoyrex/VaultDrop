"use client";

import type { FolderDTO } from "@/lib/api-client";
import FolderCard from "./FolderCard";

interface FolderGridProps {
  folders: FolderDTO[];
  onOpenFolder: (folder: FolderDTO, displayName: string) => void;
  onRenamed: () => void;
}

export default function FolderGrid({
  folders,
  onOpenFolder,
  onRenamed
}: FolderGridProps) {
  if (folders.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {folders.map((folder) => (
        <FolderCard
          key={folder.id}
          folder={folder}
          onClick={(displayName) => onOpenFolder(folder, displayName)}
          onRenamed={onRenamed}
        />
      ))}
    </div>
  );
}