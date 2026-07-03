"use client";

import { getPasswordStrength } from "@/lib/validation";
import { cn } from "@/lib/utils";

const STRENGTH_COLORS: Record<number, string> = {
  0: "bg-destructive",
  1: "bg-destructive",
  2: "bg-amber-500",
  3: "bg-emerald-500",
  4: "bg-emerald-600"
};

export function PasswordStrength({ password }: { password: string }) {
  const { score, label } = getPasswordStrength(password);
  const displayScore = password.length > 0 ? Math.max(score, 1) : 0;
  const bars = [0, 1, 2, 3];

  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <div className="flex gap-1.5">
        {bars.map((barIndex) => (
          <div
            key={barIndex}
            className={cn(
              "h-1.5 flex-1 rounded-full bg-muted transition-colors",
              barIndex < displayScore && STRENGTH_COLORS[displayScore]
            )}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        {password.length > 0 ? label : "Use 8+ characters with a mix of letters, numbers, and symbols"}
      </span>
    </div>
  );
}
