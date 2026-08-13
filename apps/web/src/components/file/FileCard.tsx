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
import { useVaultKeys } from "@/components/providers/vault-key-provider";
import { useFilePreview } from "@/hooks/useFilePreview";
import { fetchFileBlob, saveBlob } from "@/lib/download/decrypt-download";
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
  const { getVaultKey } = useVaultKeys();

  const [viewerOpen, setViewerOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const { base: fileBaseName, extension: fileExtension } =
    splitFileName(file.name);

  // Only relevant for encrypted files — this tab's in-memory unwrapped
  // vault DEK, if the vault is currently unlocked. `FileCard` is only ever
  // rendered once its vault's contents are shown, which the vault page
  // already gates behind `UnlockVaultGate`, so this is expected to be
  // defined whenever `file.encrypted` is true.
  const vaultDek = file.encrypted ? getVaultKey(file.vaultId) : undefined;

  const { previewUrl } = useFilePreview(file, accessToken, vaultDek);

  const isImage = file.mimeType.startsWith("image/");
  const isPdf = file.mimeType === "application/pdf";

  async function handleDownload() {
    if (!accessToken) return;

    try {
      const blob = await fetchFileBlob(file, accessToken, vaultDek);
      saveBlob(blob, file.name);
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