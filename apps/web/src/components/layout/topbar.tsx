"use client";

import * as React from "react";
import { LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/auth-provider";

export function Topbar() {
  const { user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);

  async function handleLogout(): Promise<void> {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <span className="text-sm font-medium text-muted-foreground">Dashboard</span>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <User className="h-4 w-4" />
          </span>
          <span className="font-medium">{user?.username}</span>
        </div>
        <Button variant="outline" size="sm" isLoading={isLoggingOut} onClick={handleLogout}>
          {!isLoggingOut && <LogOut className="h-4 w-4" />}
          Logout
        </Button>
      </div>
    </header>
  );
}
