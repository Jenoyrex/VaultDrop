"use client";

import type { FolderDTO } from "@/lib/api-client";
import FolderCard from "./FolderCard";

interface FolderGridProps {
  folders: FolderDTO[];
  onOpenFolder: (folder: FolderDTO) => void;
}

export default function FolderGrid({
  folders,
  onOpenFolder
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
          onClick={() => onOpenFolder(folder)}
        />
      ))}
    </div>
  );
}