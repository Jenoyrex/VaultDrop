"use client";

import { useEffect, useState } from "react";
import { loadWebEnv } from "@vaultdrop/config";

const env = loadWebEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL
});

export function useFilePreview(
  fileId: string,
  mimeType: string,
  token: string | null
) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;

    const isImage = mimeType.startsWith("image/");
    const isPdf = mimeType === "application/pdf";

    if (!isImage && !isPdf) {
      return;
    }

    let objectUrl: string | null = null;

    async function loadPreview() {
      try {
        setLoading(true);

        const response = await fetch(
          `${env.NEXT_PUBLIC_API_URL}/files/${fileId}/preview`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        );

        if (!response.ok) {
          throw new Error("Failed to load preview");
        }

        const blob = await response.blob();

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
  }, [fileId, mimeType, token]);

  return {
    previewUrl,
    loading
  };
}