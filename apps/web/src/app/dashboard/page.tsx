"use client";

import { motion } from "framer-motion";
import { Vault } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-center"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Vault className="h-7 w-7" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">
        Welcome, {user?.username ?? "there"}.
      </h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Your vault is ready. File uploads and folders are coming in the next sprint.
      </p>
    </motion.div>
  );
}
