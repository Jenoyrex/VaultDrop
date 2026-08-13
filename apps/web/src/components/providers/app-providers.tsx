"use client";

import * as React from "react";
import { AuthProvider } from "@/components/providers/auth-provider";
import { VaultKeyProvider } from "@/components/providers/vault-key-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <VaultKeyProvider>{children}</VaultKeyProvider>
    </AuthProvider>
  );
}
