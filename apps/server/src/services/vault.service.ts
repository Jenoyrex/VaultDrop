import type { PrismaClient, Vault } from "@prisma/client";
import type { VaultDTO } from "@vaultdrop/types";
import { AppError } from "../utils/app-error.js";

function toVaultDTO(vault: Vault): VaultDTO {
  return {
    id: vault.id,
    name: vault.name,
    ownerId: vault.ownerId,
    createdAt: vault.createdAt.toISOString(),
    updatedAt: vault.updatedAt.toISOString()
  };
}

export class VaultService {
  constructor(private readonly prisma: PrismaClient) {}

  async createVault(ownerId: string, name: string): Promise<VaultDTO> {
    const vault = await this.prisma.vault.create({
      data: { name, ownerId }
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
}
