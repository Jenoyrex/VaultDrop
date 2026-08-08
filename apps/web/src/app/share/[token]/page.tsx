"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  ShieldCheck,
  Lock,
  Download,
  FileText,
  Loader2,
  AlertTriangle
} from "lucide-react";

import {
  shareApi,
  ApiError,
  type ShareMetadata
} from "@/lib/api-client";

export default function PublicSharePage() {
  const params = useParams();
  const token = params.token as string;

  const [metadata, setMetadata] = useState<ShareMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [expired, setExpired] = useState(false);

  const [password, setPassword] = useState("");
  const [unlockedPassword, setUnlockedPassword] = useState
    string | undefined
  >(undefined);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);

        const result = await shareApi.getMetadata(token);

        if (!cancelled) {
          setMetadata(result);
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 410) {
            setExpired(true);
          } else {
            setNotFound(true);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleUnlock() {
    if (!password.trim()) {
      setPasswordError("Enter the password for this link.");
      return;
    }

    try {
      setUnlocking(true);
      setPasswordError(null);

      const result = await shareApi.getMetadata(token, password);

      setMetadata(result);
      setUnlockedPassword(password);
    } catch (err) {
      console.error(err);
      setPasswordError("Incorrect password.");
    } finally {
      setUnlocking(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Link not found</h1>
        <p className="text-muted-foreground">
          This share link doesn&apos;t exist or has been removed.
        </p>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Link expired</h1>
        <p className="text-muted-foreground">
          This share link is no longer available.
        </p>
      </div>
    );
  }

  if (!metadata) {
    return null;
  }

  if (metadata.requiresPassword && !metadata.file) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl">

          <div className="flex flex-col items-center gap-3 text-center">
            <Lock className="h-10 w-10 text-primary" />
            <h1 className="text-xl font-bold">Password Protected</h1>
            <p className="text-muted-foreground">
              Enter the password to view this file.
            </p>
          </div>

          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (passwordError) setPasswordError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleUnlock();
            }}
            placeholder="Password"
            autoFocus
            className="mt-5 w-full rounded-lg border bg-background p-3 outline-none"
          />

          {passwordError && (
            <p className="mt-2 text-sm text-red-600">
              {passwordError}
            </p>
          )}

          <button
            disabled={unlocking}
            onClick={handleUnlock}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-primary-foreground disabled:opacity-60"
          >
            {unlocking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Unlock"
            )}
          </button>

        </div>
      </div>
    );
  }

  const file = metadata.file!;
  const isImage = file.mimeType.startsWith("image/");
  const isPdf = file.mimeType === "application/pdf";

  const previewUrl = shareApi.previewUrl(token, unlockedPassword);
  const downloadUrl = shareApi.downloadUrl(token, unlockedPassword);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl rounded-xl border bg-card p-6 shadow-xl">

        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <span className="text-sm text-muted-foreground">
            Shared via VaultDrop
          </span>
        </div>

        <h1 className="mt-4 truncate text-2xl font-bold">
          {file.name}
        </h1>

        <div className="mt-1 flex gap-4 text-sm text-muted-foreground">
          <span>{(file.sizeBytes / 1024).toFixed(2)} KB</span>
          <span>{new Date(file.createdAt).toLocaleString()}</span>
        </div>

        <div className="mt-6 flex h-96 items-center justify-center overflow-hidden rounded-lg bg-muted">
          {isImage ? (
            <img
              src={previewUrl}
              alt={file.name}
              className="h-full w-full object-contain"
            />
          ) : isPdf ? (
            <iframe
              src={previewUrl}
              title={file.name}
              className="h-full w-full"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <FileText className="h-14 w-14" />
              <p>Preview not available for this file type.</p>
            </div>
          )}
        </div>

        
          href={downloadUrl}
          download={file.name}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-primary-foreground"
        >
          <Download className="h-5 w-5" />
          Download
        </a>

      </div>
    </div>
  );
}