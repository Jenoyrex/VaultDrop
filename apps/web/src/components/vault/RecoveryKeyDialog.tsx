"use client";

import { useState } from "react";
import { Check, Copy, ShieldAlert } from "lucide-react";

interface RecoveryKeyDialogProps {
  /** Already generated and already enrolled with the server — this
   * component only displays it and confirms the user saved it. */
  recoveryKey: string;
  onDone: () => void;
}

/**
 * Shows a freshly generated recovery key exactly once. The key is never
 * fetched again after this dialog closes — it lives only in this
 * component's props/state while mounted, never in localStorage/
 * sessionStorage/IndexedDB, matching the same in-memory-only handling as
 * the account password and unwrapped vault DEK elsewhere in this app.
 */
export default function RecoveryKeyDialog({
  recoveryKey,
  onDone
}: RecoveryKeyDialogProps) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
    } catch {
      // Clipboard access can be denied by the browser; the key is still
      // shown on screen for manual copying, so this isn't fatal.
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-center gap-2 text-amber-600">
          <ShieldAlert className="h-5 w-5" />
          <h2 className="text-xl font-bold text-gray-900">
            Save your recovery key
          </h2>
        </div>

        <p className="mt-2 text-sm text-gray-500">
          This is the only way to unlock this vault if you ever forget your
          password. It&rsquo;s shown only once and is never stored on our
          servers — if you lose it, no one, including us, can recover your
          files.
        </p>

        <div className="mt-4 select-all break-all rounded-lg border bg-gray-50 p-4 font-mono text-sm text-gray-900">
          {recoveryKey}
        </div>

        <button
          onClick={handleCopy}
          className="mt-3 flex items-center gap-2 rounded-lg border px-4 py-2 text-sm"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy to clipboard"}
        </button>

        <label className="mt-5 flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5"
          />
          I&rsquo;ve saved this recovery key somewhere safe.
        </label>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onDone}
            disabled={!confirmed}
            className="rounded-lg bg-violet-600 px-4 py-2 text-white disabled:opacity-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
