import type { PrismaClient } from "@prisma/client";
import { hashPassword, signAccessToken, verifyPassword } from "@vaultdrop/crypto";
import type { ServerEnv } from "@vaultdrop/config";
import type { UserDTO, VaultPasswordRewrap } from "@vaultdrop/types";
import { AppError } from "../utils/app-error.js";

function toUserDTO(user: { id: string; username: string; createdAt: Date }): UserDTO {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt.toISOString()
  };
}

/** Internal result: the route puts `token` in an httpOnly cookie and only `user` in the body. */
export interface IssuedSession {
  user: UserDTO;
  token: string;
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: ServerEnv
  ) {}

  async register(username: string, password: string): Promise<IssuedSession> {
    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) {
      throw AppError.conflict("Username is already taken");
    }

    const passwordHash = await hashPassword(password);
    const user = await this.prisma.user.create({
      data: { username, passwordHash }
    });

    return { user: toUserDTO(user), token: this.signFor(user) };
  }

  async login(username: string, password: string): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) {
      throw AppError.unauthorized("Invalid username or password");
    }

    const isValid = await verifyPassword(user.passwordHash, password);
    if (!isValid) {
      throw AppError.unauthorized("Invalid username or password");
    }

    return { user: toUserDTO(user), token: this.signFor(user) };
  }

  private signFor(user: { id: string; username: string; tokenVersion: number }): string {
    return signAccessToken({
      userId: user.id,
      username: user.username,
      tokenVersion: user.tokenVersion,
      secret: this.env.JWT_SECRET,
      expiresIn: this.env.JWT_EXPIRES_IN
    });
  }

  /**
   * Server-side logout: bumping `tokenVersion` makes every token issued
   * to this user so far fail the auth middleware's version check, on every
   * device. (Revoking one device at a time would need a session table.)
   */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } }
    });
  }

  async getCurrentUser(userId: string): Promise<UserDTO> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw AppError.notFound("User not found");
    }
    return toUserDTO(user);
  }

  async usernameExists(username: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    return user !== null;
  }

  /**
   * Changes the account password and re-wraps every currently-encrypted
   * vault's DEK under the new password's KEK, atomically. `vaultRewraps`
   * must already be the client-computed new envelopes (this method never
   * sees a KEK or DEK — only opaque ciphertext/IV/KDF-param fields).
   *
   * The completeness check below — comparing the account's *live* set of
   * encrypted vaults against exactly what was submitted — is what
   * prevents a partial migration: if even one encrypted vault is missing
   * from `vaultRewraps` (locked, corrupted, a stale client snapshot, a
   * race with a concurrent vault create/delete, or a malicious/buggy
   * client), the whole operation is rejected *before* `User.passwordHash`
   * or any vault row is touched. `User.passwordHash` and every vault's
   * password-wrap columns are updated together in one DB transaction, so
   * there is no way to observe a state where the account's login
   * credential and any vault's wrapping have diverged. Recovery envelope
   * columns are never referenced anywhere in this method, so they can
   * never be affected by it.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    vaultRewraps: VaultPasswordRewrap[]
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw AppError.unauthorized();
    }

    const isValid = await verifyPassword(user.passwordHash, currentPassword);
    if (!isValid) {
      throw AppError.unauthorized("Incorrect current password");
    }

    const newPasswordHash = await hashPassword(newPassword);

    // The password hash and tokenVersion change in the same update, so
    // every other session is revoked atomically with the password change.
    // The bumped version is returned so the caller can re-issue a token
    // for the device that made this request.
    const tokenVersion = await this.prisma.$transaction(async (tx) => {
      // Live re-read, inside the transaction — not trusted from an
      // earlier client-side snapshot — of exactly which vaults this
      // account currently has encrypted (legacy plaintext vaults are
      // excluded by the `wrappedDekCiphertext: { not: null }` filter and
      // never need a rewrap entry at all).
      const ownedEncryptedVaults = await tx.vault.findMany({
        where: { ownerId: userId, wrappedDekCiphertext: { not: null } },
        select: { id: true }
      });

      const ownedIds = new Set(ownedEncryptedVaults.map((vault) => vault.id));
      const submittedIds = new Set(vaultRewraps.map((rewrap) => rewrap.vaultId));

      const missing = [...ownedIds].filter((id) => !submittedIds.has(id));
      // Covers both "no such vault" and "belongs to a different account"
      // — `ownedIds` is already scoped to `ownerId: userId`, so a foreign
      // vault's id can never appear there regardless of whether it's a
      // real, currently-encrypted vault for someone else.
      const unknownOrForeign = [...submittedIds].filter((id) => !ownedIds.has(id));

      if (missing.length > 0 || unknownOrForeign.length > 0) {
        throw new AppError(
          409,
          "VAULT_SET_MISMATCH",
          "The submitted vault set does not exactly match this account's currently encrypted vaults",
          { missing, unknownOrForeign }
        );
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash, tokenVersion: { increment: 1 } }
      });

      for (const rewrap of vaultRewraps) {
        await tx.vault.update({
          where: { id: rewrap.vaultId },
          data: {
            encryptionVersion: rewrap.encryptionVersion,
            kekSalt: rewrap.kekSalt,
            kekIterations: rewrap.kekIterations,
            kekHash: rewrap.kekHash,
            wrappedDekCiphertext: rewrap.wrappedDekCiphertext,
            wrappedDekIv: rewrap.wrappedDekIv
            // recoveryWrappedDekCiphertext/recoveryWrappedDekIv: deliberately
            // absent from this object, so Prisma leaves them untouched.
          }
        });
      }

      return updated.tokenVersion;
    });

    return this.signFor({ id: user.id, username: user.username, tokenVersion });
  }
}
