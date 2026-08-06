"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Vault } from "lucide-react";
import type { VaultDTO } from "@vaultdrop/types";

import { vaultApi } from "@/lib/api-client";
import { useAuth } from "@/components/providers/auth-provider";
import CreateVaultDialog from "@/components/vault/CreateVaultDialog";

export default function DashboardPage() {
  const { user, accessToken } = useAuth();

  const [vaults, setVaults] = useState<VaultDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const loadVaults = useCallback(async () => {
    if (!accessToken) {
      setVaults([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await vaultApi.list(accessToken);
      setVaults(response.vaults);
    } catch (error) {
      console.error("Failed to load vaults:", error);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    loadVaults();
  }, [loadVaults]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading vaults...</p>
      </div>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-8"
      >
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold">
              Welcome, {user?.username ?? "there"} 👋
            </h1>

            <p className="mt-1 text-muted-foreground">
              Manage all your secure vaults.
            </p>
          </div>

          <button
            onClick={() => setShowCreateDialog(true)}
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground transition hover:opacity-90"
          >
            + New Vault
          </button>
        </div>

        {vaults.length === 0 ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Vault className="h-8 w-8" />
            </div>

            <h2 className="text-xl font-semibold">
              No vaults yet
            </h2>

            <p className="max-w-sm text-sm text-muted-foreground">
              Create your first vault to start storing your encrypted files.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {vaults.map((vault) => (
              <Link
                key={vault.id}
                href={`/dashboard/vaults/${vault.id}`}
                className="block rounded-xl border border-border bg-card p-5 transition hover:scale-[1.02] hover:shadow-lg"
              >
                <Vault className="mb-4 h-8 w-8 text-primary" />

                <h3 className="text-lg font-semibold">
                  {vault.name}
                </h3>

                <p className="mt-2 text-sm text-muted-foreground">
                  Created {new Date(vault.createdAt).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </motion.div>

      {showCreateDialog && (
        <CreateVaultDialog
          onClose={() => setShowCreateDialog(false)}
          onCreated={loadVaults}
        />
      )}
    </>
  );
}