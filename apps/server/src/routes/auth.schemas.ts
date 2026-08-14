import { z } from "zod";

export const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(32, "Username must be at most 32 characters")
  .regex(/^[a-zA-Z0-9_.-]+$/, "Username may only contain letters, numbers, _, . and -");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema
});

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, "Password is required")
});

const vaultRewrapEntrySchema = z.object({
  vaultId: z.string().uuid(),
  encryptionVersion: z.number().int().positive(),
  kekSalt: z.string().min(1),
  kekIterations: z.number().int().positive(),
  kekHash: z.string().min(1),
  wrappedDekCiphertext: z.string().min(1),
  wrappedDekIv: z.string().min(1)
});

// Duplicate vaultIds are rejected here, cheaply, before any DB access —
// the authoritative "does this exactly match the account's currently
// encrypted vaults" check happens in AuthService.changePassword, inside
// the same transaction that applies the change.
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordSchema,
    vaults: z.array(vaultRewrapEntrySchema)
  })
  .refine(
    (data) => new Set(data.vaults.map((vault) => vault.vaultId)).size === data.vaults.length,
    { message: "Duplicate vault ID in password-change submission", path: ["vaults"] }
  );
