"use client";

import { X, Download, Trash2 } from "lucide-react";
import { fileApi, type FileDTO } from "@/lib/api-client";
import { useAuth } from "@/components/providers/auth-provider";

interface ImageViewerProps {
  file: FileDTO;
  imageUrl: string;
  onClose: () => void;
  onDeleted: () => void;
}

export default function ImageViewer({
  file,
  imageUrl,
  onClose,
  onDeleted
}: ImageViewerProps) {
  const { accessToken } = useAuth();

  async function handleDownload() {
    if (!accessToken) return;

    const response = await fileApi.download(
      file.id,
      accessToken
    );

    const blob = await response.blob();

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;
    a.download = file.name;

    a.click();

    URL.revokeObjectURL(url);
  }

  async function handleDelete() {
    if (!accessToken) return;

    if (!confirm(`Delete "${file.name}"?`)) {
      return;
    }

    await fileApi.delete(
      file.id,
      accessToken
    );

    onDeleted();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={imageUrl}
          alt={file.name}
          className="max-h-[80vh] rounded-lg"
        />

        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white"
        >
          <X />
        </button>

        <div className="mt-4 flex justify-center gap-4">

          <button
            onClick={handleDownload}
            className="flex items-center gap-2 rounded-lg bg-white px-4 py-2"
          >
            <Download size={18} />
            Download
          </button>

          <button
            onClick={handleDelete}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-white"
          >
            <Trash2 size={18} />
            Delete
          </button>

        </div>

      </div>
    </div>
  );
}