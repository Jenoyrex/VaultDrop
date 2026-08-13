"use client";

import { useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  Download,
  Trash2,
  Pencil,
  Lock
} from "lucide-react";

import {
  fileApi,
  type FileDTO
} from "@/lib/api-client";

import { useAuth } from "@/components/providers/auth-provider";
import { useFilePreview } from "@/hooks/useFilePreview";
import ImageViewer from "./ImageViewer";
import PdfViewer from "./PdfViewer";
import RenameDialog from "@/components/shared/RenameDialog";

function splitFileName(fileName: string): {
  base: string;
  extension: string;
} {
  const lastDot = fileName.lastIndexOf(".");

  if (lastDot <= 0) {
    return { base: fileName, extension: "" };
  }

  return {
    base: fileName.slice(0, lastDot),
    extension: fileName.slice(lastDot)
  };
}

interface FileCardProps {
  file: FileDTO;
  onDeleted: () => void;
  onRenamed: () => void;
  pathLabel?: string;
}

export default function FileCard({
  file,
  onDeleted,
  onRenamed,
  pathLabel
}: FileCardProps) {

  const { accessToken } = useAuth();

  const [viewerOpen, setViewerOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const { base: fileBaseName, extension: fileExtension } =
    splitFileName(file.name);

  // Checkpoint 4 wires up encrypted *uploads* only — encrypted download/
  // preview is explicitly out of scope until a later checkpoint. An
  // encrypted file's stored bytes are ciphertext, so previewing/
  // downloading it today would just hand back undecryptable data; guard
  // both instead of showing a broken image or a garbage download.
  const { previewUrl } = useFilePreview(
    file.id,
    file.encrypted ? "" : file.mimeType,
    accessToken
  );

  const isImage = !file.encrypted && file.mimeType.startsWith("image/");
  const isPdf = !file.encrypted && file.mimeType === "application/pdf";

  async function handleDownload() {
    if (!accessToken || file.encrypted) return;

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

  async function handleRename(newName: string) {
    if (!accessToken) return;

    await fileApi.rename(
      file.id,
      newName,
      accessToken
    );

    onRenamed();
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

          <h3 className="flex items-center gap-1.5 truncate font-semibold">
            {file.encrypted && (
              <Lock
                className="h-3.5 w-3.5 shrink-0 text-primary"
                aria-label="Encrypted"
              />
            )}
            <span className="truncate">{file.name}</span>
          </h3>

          {pathLabel && (
            <p className="truncate text-xs text-muted-foreground">
              {pathLabel}
            </p>
          )}

          <p className="text-sm text-muted-foreground">
            {(file.sizeBytes / 1024).toFixed(2)} KB
          </p>

          <p className="text-xs text-muted-foreground">
            {new Date(file.createdAt).toLocaleString()}
          </p>

          <div className="mt-4 flex gap-2">

            <button
              onClick={handleDownload}
              disabled={file.encrypted}
              title={
                file.encrypted
                  ? "Encrypted files can't be previewed or downloaded yet"
                  : undefined
              }
              className="rounded-lg border p-2 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Download className="h-4 w-4" />
            </button>

            <button
              onClick={() => setRenameOpen(true)}
              className="rounded-lg border p-2 hover:bg-accent"
            >
              <Pencil className="h-4 w-4" />
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

      <RenameDialog
        open={renameOpen}
        title="Rename File"
        initialName={fileBaseName}
        extension={fileExtension}
        onClose={() => setRenameOpen(false)}
        onRename={handleRename}
      />

    </>
  );
}