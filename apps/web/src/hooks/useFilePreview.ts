"use client";

import { useEffect, useState } from "react";
import { fileApi } from "@/lib/api-client";
import { unwrapFileKey, decryptResponseToBlob } from "@/lib/download/decrypt-download";

/** The subset of a FileDTO needed to load (and, if encrypted, decrypt) its preview. */
export interface PreviewableFile {
  id: string;
  mimeType: string;
  encrypted: boolean;
  wrappedKeyCiphertext: string | null;
  wrappedKeyIv: string | null;
}

export function useFilePreview(
  file: PreviewableFile,
  token: string | null,
  vaultDek: CryptoKey | undefined
) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;

    const isImage = file.mimeType.startsWith("image/");
    const isPdf = file.mimeType === "application/pdf";

    if (!isImage && !isPdf) {
      return;
    }

    // An encrypted file's preview can't be decrypted until this tab holds
    // the vault's unwrapped DEK — skip loading rather than fetching
    // ciphertext there's no key to decrypt yet.
    if (file.encrypted && !vaultDek) {
      return;
    }

    let objectUrl: string | null = null;

    async function loadPreview() {
      try {
        setLoading(true);

        const response = await fileApi.preview(file.id, token as string);

        if (!response.ok) {
          throw new Error("Failed to load preview");
        }

        const blob = file.encrypted
          ? await decryptResponseToBlob(
              response,
              await unwrapFileKey(file, vaultDek as CryptoKey),
              file.mimeType
            )
          : await response.blob();

        objectUrl = URL.createObjectURL(blob);

        setPreviewUrl(objectUrl);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadPreview();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [
    file.id,
    file.mimeType,
    file.encrypted,
    file.wrappedKeyCiphertext,
    file.wrappedKeyIv,
    token,
    vaultDek
  ]);

  return {
    previewUrl,
    loading
  };
}
