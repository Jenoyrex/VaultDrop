"use client";

import { ShieldCheck, Vault, FolderClosed, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Vault", icon: Vault, active: true },
  { label: "Folders", icon: FolderClosed, active: false },
  { label: "Sharing", icon: Users, active: false },
  { label: "Settings", icon: Settings, active: false }
];

export function Sidebar() {
  return (
    <aside className="hidden w-60 flex-col border-r border-border bg-card px-4 py-6 sm:flex">
      <div className="mb-8 flex items-center gap-2 px-2 text-primary">
        <ShieldCheck className="h-6 w-6" />
        <span className="text-lg font-semibold text-foreground">VaultDrop</span>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={!item.active}
            title={item.active ? undefined : "Coming soon"}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              item.active
                ? "bg-accent text-accent-foreground"
                : "cursor-not-allowed text-muted-foreground/60"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
            {!item.active && (
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Soon
              </span>
            )}
          </button>
        ))}
      </nav>
    </aside>
  );
}
