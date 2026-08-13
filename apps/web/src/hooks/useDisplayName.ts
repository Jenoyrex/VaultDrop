"use client";

import { useEffect, useState } from "react";
import {
  resolveDisplayName,
  type NamedEntity
} from "@/lib/names/resolve-name";

/**
 * Resolves `entity`'s display name for rendering, decrypting client-side
 * when it's encrypted. Mirrors `useFilePreview`'s shape (async work in an
 * effect, cancellation-safe). The resolved name is only ever held in this
 * component's React state — never persisted anywhere.
 */
export function useDisplayName(
  entity: NamedEntity,
  vaultDek: CryptoKey | undefined
): { displayName: string | null; error: string | null } {
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    resolveDisplayName(entity, vaultDek)
      .then((name) => {
        if (cancelled) return;
        setDisplayName(name);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setDisplayName(null);
        setError(err instanceof Error ? err.message : "Failed to resolve name");
      });

    return () => {
      cancelled = true;
    };
  }, [
    entity.encrypted,
    entity.name,
    entity.encryptedName,
    entity.nameIv,
    vaultDek
  ]);

  return { displayName, error };
}
