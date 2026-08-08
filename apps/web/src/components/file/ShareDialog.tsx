"use client";

import { useEffect, useState } from "react";
import { Link2, Copy, Check, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import {
  shareApi,
  type ShareDTO,
  type ShareExpiryOption
} from "@/lib/api-client";
import { useAuth } from "@/components/providers/auth-provider";

interface ShareDialogProps {
  open: boolean;
  fileId: string;
  fileName: string;
  onClose: () => void;
}

const EXPIRY_OPTIONS: { value: ShareExpiryOption; label: string }[] = [
  { value: "never", label: "Never" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" }
];

export default function ShareDialog({
  open,
  fileId,
  fileName,
  onClose
}: ShareDialogProps) {
  const { accessToken } = useAuth();

  const [expiresIn, setExpiresIn] = useState<ShareExpiryOption>("never");
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdShare, setCreatedShare] = useState<ShareDTO | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setExpiresIn("never");
      setPasswordEnabled(false);
      setPassword("");
      setCreating(false);
      setError(null);
      setCreatedShare(null);
      setCopied(false);
    }
  }, [open]);

  if (!open) return null;

  const shareUrl = createdShare
    ? `${window.location.origin}/share/${createdShare.token}`
    : "";

  async function handleCreate() {
    if (!accessToken) return;

    if (passwordEnabled && password.trim().length === 0) {
      setError("Enter a password, or turn password protection off.");
      return;
    }

    try {
      setCreating(true);
      setError(null);

      const result = await shareApi.create(
        fileId,
        {
          expiresIn,
          password: passwordEnabled ? password.trim() : undefined
        },
        accessToken
      );

      setCreatedShare(result.share);
    } catch (err) {
      console.error(err);
      setError("Could not create the share link.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-2xl font-bold">
          Share File
        </h2>

        <p className="mt-2 truncate text-muted-foreground">
          {fileName}
        </p>

        {!createdShare ? (
          <>
            <div className="mt-6 space-y-5">

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Expiration
                </label>

                <select
                  value={expiresIn}
                  onChange={(e) =>
                    setExpiresIn(e.target.value as ShareExpiryOption)
                  }
                  className="w-full rounded-lg border bg-background p-3 outline-none"
                >
                  {EXPIRY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={passwordEnabled}
                    onChange={(e) => {
                      setPasswordEnabled(e.target.checked);
                      if (error) setError(null);
                    }}
                  />
                  Password protect this link
                </label>

                {passwordEnabled && (
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Enter a password"
                    autoFocus
                    className="mt-3 w-full rounded-lg border bg-background p-3 outline-none"
                  />
                )}
              </div>

            </div>

            {error && (
              <p className="mt-4 text-sm text-red-600">
                {error}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">

              <button
                onClick={onClose}
                className="rounded-lg border px-4 py-2"
              >
                Cancel
              </button>

              <button
                disabled={creating}
                onClick={handleCreate}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Link2 className="h-4 w-4" />
                    Create Link
                  </>
                )}
              </button>

            </div>
          </>
        ) : (
          <>
            <div className="mt-6 flex flex-col items-center gap-4">

              <div className="rounded-lg border bg-white p-4">
                <QRCodeSVG value={shareUrl} size={160} />
              </div>

              <div className="flex w-full items-center gap-2">

                <input
                  readOnly
                  value={shareUrl}
                  className="w-full truncate rounded-lg border bg-background p-3 text-sm outline-none"
                />

                <button
                  onClick={handleCopy}
                  className="flex shrink-0 items-center gap-2 rounded-lg border p-3 hover:bg-accent"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>

              </div>

              <p className="text-center text-sm text-muted-foreground">
                {createdShare.hasPassword
                  ? "Anyone with this link and the password can view this file."
                  : "Anyone with this link can view this file."}
                {createdShare.expiresAt && (
                  <>
                    {" "}
                    Expires {new Date(createdShare.expiresAt).toLocaleString()}.
                  </>
                )}
              </p>

            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={onClose}
                className="rounded-lg border px-4 py-2"
              >
                Done
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}