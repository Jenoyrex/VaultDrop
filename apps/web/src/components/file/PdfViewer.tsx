"use client";

import { useEffect } from "react";
import { X, Download, Trash2 } from "lucide-react";

interface PdfViewerProps {
  /** Already-resolved (decrypted, if applicable) display name — never re-derived from `file.name`, which is null for an encrypted file. */
  displayName: string;
  pdfUrl: string;
  onClose: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

export default function PdfViewer({
  displayName,
  pdfUrl,
  onClose,
  onDownload,
  onDelete
}: PdfViewerProps) {

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <div
        className="relative flex h-[90vh] w-[90vw] max-w-5xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 overflow-hidden rounded-lg bg-white">
          <iframe
            src={pdfUrl}
            title={displayName}
            className="h-full w-full"
          />
        </div>

        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white"
        >
          <X />
        </button>

        <div className="mt-4 flex justify-center gap-4">

          <button
            onClick={onDownload}
            className="flex items-center gap-2 rounded-lg bg-white px-4 py-2"
          >
            <Download size={18} />
            Download
          </button>

          <button
            onClick={onDelete}
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