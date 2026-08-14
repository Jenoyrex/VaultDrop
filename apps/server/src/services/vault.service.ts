import type { PrismaClient, Vault } from "@prisma/client";
import type {
  RecoveryEnvelopeResponse,
  VaultDTO,
  VaultEncryptionEnvelope
} from "@vaultdrop/types";
import { AppError } from "../utils/app-error.js";

function toVaultDTO(vault: Vault): VaultDTO {
  return {
    id: vault.id,
    name: vault.name,
    ownerId: vault.ownerId,
    createdAt: vault.createdAt.toISOString(),
    updatedAt: vault.updatedAt.toISOString(),
    encryptionVersion: vault.encryptionVersion,
    kekSalt: vault.kekSalt,
    kekIterations: vault.kekIterations,
    kekHash: vault.kekHash,
    wrappedDekCiphertext: vault.wrappedDekCiphertext,
    wrappedDekIv: vault.wrappedDekIv,
    hasRecoveryKey: vault.recoveryWrappedDekCiphertext !== null
    // Deliberately omitted: vault.recoveryWrappedDekCiphertext / recoveryWrappedDekIv.
    // Recovery-wrap material must never flow through this general, owner-scoped DTO
    // — only `hasRecoveryKey` (a safe yes/no signal) and the dedicated
    // getRecoveryEnvelope() below, which is wired to its own route, ever expose it.
  };
}

export class VaultService {
  constructor(private readonly prisma: PrismaClient) {}

  async createVault(
    ownerId: string,
    name: string,
    encryption?: VaultEncryptionEnvelope
  ): Promise<VaultDTO> {
    const vault = await this.prisma.vault.create({
      data: {
        name,
        ownerId,
        ...(encryption
          ? {
              encryptionVersion: encryption.encryptionVersion,
              kekSalt: encryption.kekSalt,
              kekIterations: encryption.kekIterations,
              kekHash: encryption.kekHash,
              wrappedDekCiphertext: encryption.wrappedDekCiphertext,
              wrappedDekIv: encryption.wrappedDekIv
            }
          : {})
      }
    });
    return toVaultDTO(vault);
  }

  async listVaults(ownerId: string): Promise<VaultDTO[]> {
    const vaults = await this.prisma.vault.findMany({
      where: { ownerId },
      orderBy: { createdAt: "desc" }
    });
    return vaults.map(toVaultDTO);
  }

  async getOwnedVaultOrThrow(vaultId: string, ownerId: string): Promise<Vault> {
    const vault = await this.prisma.vault.findUnique({ where: { id: vaultId } });
    if (!vault) {
      throw AppError.notFound("Vault not found");
    }
    if (vault.ownerId !== ownerId) {
      throw AppError.forbidden("You do not have access to this vault");
    }
    return vault;
  }

  async getVault(vaultId: string, ownerId: string): Promise<VaultDTO> {
    const vault = await this.getOwnedVaultOrThrow(vaultId, ownerId);
    return toVaultDTO(vault);
  }

  async deleteVault(vaultId: string, ownerId: string): Promise<void> {
    await this.getOwnedVaultOrThrow(vaultId, ownerId);
    await this.prisma.vault.delete({ where: { id: vaultId } });
  }

  /**
   * Enrolls or rotates a vault's recovery envelope. `envelope` is an
   * opaque ciphertext/IV pair the browser already produced by wrapping
   * the vault DEK with a freshly generated recovery key — this method
   * never sees the recovery key or the DEK, only stores what it's given.
   * A vault must already carry a password-wrapped DEK (i.e. already be an
   * encrypted vault) before it can have a recovery envelope; there is
   * nothing meaningful to recover on a legacy plaintext vault. Calling
   * this again for a vault that already has a recovery envelope replaces
   * it outright — the previous ciphertext is gone the instant this
   * commits, which is what permanently invalidates the previous recovery
   * key (it no longer has anything left to unwrap).
   */
  async enrollRecoveryKey(
    vaultId: string,
    ownerId: string,
    envelope: RecoveryEnvelopeResponse
  ): Promise<VaultDTO> {
    const vault = await this.getOwnedVaultOrThrow(vaultId, ownerId);
    if (!vault.wrappedDekCiphertext) {
      throw AppError.badRequest(
        "This vault has no encryption envelope, so it cannot have a recovery key"
      );
    }

    const updated = await this.prisma.vault.update({
      where: { id: vaultId },
      data: {
        recoveryWrappedDekCiphertext: envelope.recoveryWrappedDekCiphertext,
        recoveryWrappedDekIv: envelope.recoveryWrappedDekIv
      }
    });
    return toVaultDTO(updated);
  }

  /**
   * Returns the vault's recovery-wrapped DEK ciphertext — the one place
   * this material is ever allowed to leave storage. Deliberately not part
   * of `getVault`/`toVaultDTO`; only the dedicated recovery route calls
   * this, and only for the vault's owner.
   */
  async getRecoveryEnvelope(
    vaultId: string,
    ownerId: string
  ): Promise<RecoveryEnvelopeResponse> {
    const vault = await this.getOwnedVaultOrThrow(vaultId, ownerId);
    if (!vault.recoveryWrappedDekCiphertext || !vault.recoveryWrappedDekIv) {
      throw new AppError(
        404,
        "RECOVERY_NOT_CONFIGURED",
        "This vault has no recovery key configured"
      );
    }
    return {
      recoveryWrappedDekCiphertext: vault.recoveryWrappedDekCiphertext,
      recoveryWrappedDekIv: vault.recoveryWrappedDekIv
    };
  }

  /**
   * Re-wraps the vault's DEK under a fresh password-derived KEK, used
   * after recovery-key access to restore normal password unlock. Only
   * ever touches the password-wrap columns — `encryptionVersion`,
   * `kekSalt`, `kekIterations`, `kekHash`, `wrappedDekCiphertext`,
   * `wrappedDekIv` — never the recovery envelope, and never
   * `User.passwordHash`. This method has no way to verify that `envelope`
   * was actually derived from the caller's real account password (the
   * server never sees passwords); the client is responsible for proving
   * that first via a real `POST /auth/login` call before it ever calls
   * this, so the KEK this re-wraps under is always the user's one true
   * account credential, never a separate vault-only password.
   */
  async rewrapEncryption(
    vaultId: string,
    ownerId: string,
    envelope: VaultEncryptionEnvelope
  ): Promise<VaultDTO> {
    const vault = await this.getOwnedVaultOrThrow(vaultId, ownerId);
    if (!vault.wrappedDekCiphertext) {
      throw AppError.badRequest("This vault has no encryption envelope to re-wrap");
    }

    const updated = await this.prisma.vault.update({
      where: { id: vaultId },
      data: {
        encryptionVersion: envelope.encryptionVersion,
        kekSalt: envelope.kekSalt,
        kekIterations: envelope.kekIterations,
        kekHash: envelope.kekHash,
        wrappedDekCiphertext: envelope.wrappedDekCiphertext,
        wrappedDekIv: envelope.wrappedDekIv
      }
    });
    return toVaultDTO(updated);
  }
}
