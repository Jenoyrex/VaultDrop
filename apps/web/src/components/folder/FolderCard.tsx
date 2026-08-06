"use client";

import { Folder } from "lucide-react";

import type { FolderDTO } from "@/lib/api-client";

interface FolderCardProps {
  folder: FolderDTO;
  onClick: () => void;
}

export default function FolderCard({
  folder,
  onClick
}: FolderCardProps) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center rounded-xl border bg-card p-6 transition hover:shadow-xl hover:border-primary"
    >
      <Folder
        className="mb-4 h-16 w-16 text-yellow-500"
        fill="#facc15"
      />

      <h3 className="max-w-full truncate text-lg font-semibold">
        {folder.name}
      </h3>
    </button>
  );
}