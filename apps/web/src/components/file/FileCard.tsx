"use client";

import { useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  Download,
  Trash2
} from "lucide-react";

import {
  fileApi,
  type FileDTO
} from "@/lib/api-client";

import { useAuth } from "@/components/providers/auth-provider";
import { useFilePreview } from "@/hooks/useFilePreview";
import ImageViewer from "./ImageViewer";
import PdfViewer from "./PdfViewer";

interface FileCardProps {
  file: FileDTO;
  onDeleted: () => void;
}

export default function FileCard({
  file,
  onDeleted
}: FileCardProps) {

  const { accessToken } = useAuth();

  const [viewerOpen, setViewerOpen] = useState(false);

  const { previewUrl } = useFilePreview(
    file.id,
    file.mimeType,
    accessToken
  );

  const isImage = file.mimeType.startsWith("image/");
  const isPdf = file.mimeType === "application/pdf";

  async function handleDownload() {
    if (!accessToken) return;

    try {
      const response = await fileApi.download(
        file.id,
        accessToken
      );

      if (!response.ok) {
        throw new Error();
      }

      const blob = await response.blob();

      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");

      a.href = url;
      a.download = file.name;

      a.click();

      URL.revokeObjectURL(url);

    } catch {
      alert("Download failed.");
    }
  }

  async function handleDelete(): Promise<boolean> {

    if (!accessToken) return false;

    if (!confirm(`Delete "${file.name}"?`)) {
      return false;
    }

    try {

      await fileApi.delete(
        file.id,
        accessToken
      );

      onDeleted();

      return true;

    } catch {

      alert("Delete failed.");

      return false;

    }

  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border bg-card transition hover:shadow-xl">

        <div
          className="flex h-48 cursor-pointer items-center justify-center overflow-hidden bg-muted"
          onClick={() => {
            if ((isImage || isPdf) && previewUrl) {
              setViewerOpen(true);
            }
          }}
        >

          {isImage && previewUrl ? (
            <img
              src={previewUrl}
              alt={file.name}
              className="h-full w-full object-cover"
            />
          ) : isImage ? (
            <ImageIcon className="h-14 w-14 text-primary" />
          ) : (
            <FileText className="h-14 w-14 text-primary" />
          )}

        </div>

        <div className="space-y-2 p-4">

          <h3 className="truncate font-semibold">
            {file.name}
          </h3>

          <p className="text-sm text-muted-foreground">
            {(file.sizeBytes / 1024).toFixed(2)} KB
          </p>

          <p className="text-xs text-muted-foreground">
            {new Date(file.createdAt).toLocaleString()}
          </p>

          <div className="mt-4 flex gap-2">

            <button
              onClick={handleDownload}
              className="rounded-lg border p-2 hover:bg-accent"
            >
              <Download className="h-4 w-4" />
            </button>

            <button
              onClick={handleDelete}
              className="rounded-lg border p-2 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>

          </div>

        </div>

      </div>

      {viewerOpen && previewUrl && isImage && (

        <ImageViewer
          file={file}
          imageUrl={previewUrl}
          onClose={() => setViewerOpen(false)}
          onDeleted={onDeleted}
        />

      )}

      {viewerOpen && previewUrl && isPdf && (

        <PdfViewer
          file={file}
          pdfUrl={previewUrl}
          onClose={() => setViewerOpen(false)}
          onDownload={handleDownload}
          onDelete={async () => {
            const success = await handleDelete();

            if (success) {
              setViewerOpen(false);
            }
          }}
        />

      )}

    </>
  );
}