import { z } from "zod";

// Mirrors apps/server/src/routes/auth.schemas.ts. Kept in sync by hand since
// apps/web must not import server-internal modules; this is intentionally a
// duplicate, not a shared package, per the frozen package boundaries.
export const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(32, "Username must be at most 32 characters")
  .regex(/^[a-zA-Z0-9_.-]+$/, "Only letters, numbers, _, . and - are allowed");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

export interface PasswordStrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Very weak" | "Weak" | "Fair" | "Strong" | "Very strong";
}

export function getPasswordStrength(password: string): PasswordStrengthResult {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  const clamped = Math.min(score, 4) as PasswordStrengthResult["score"];
  const labels: Record<PasswordStrengthResult["score"], PasswordStrengthResult["label"]> = {
    0: "Very weak",
    1: "Weak",
    2: "Fair",
    3: "Strong",
    4: "Very strong"
  };
  return { score: clamped, label: labels[clamped] };
}
