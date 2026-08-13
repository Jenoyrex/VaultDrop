/**
 * Glue between the app (VaultDTO from the API) and the browser-only crypto
 * primitives in `lib/crypto/`. Every function here runs entirely
 * client-side: the password, the derived KEK, and the unwrapped DEK never
 * leave the browser and are never sent to the server.
 */
import type { VaultDTO, VaultEncryptionEnvelope } from "@vaultdrop/types";
import { deriveKek, wrapKey, unwrapKey, generateAesKey } from "@/lib/crypto";

/** DEK key usages needed to later wrap/unwrap per-file keys and, in a
 * future checkpoint, encrypt/decrypt file content directly. */
const DEK_USAGES: KeyUsage[] = ["encrypt", "decrypt", "wrapKey", "unwrapKey"];

/** Current zero-knowledge envelope version this client writes. */
export const CURRENT_ENCRYPTION_VERSION = 1;

/** True when every envelope field on a vault is present (an encrypted vault). */
export function hasEncryptionEnvelope(
  vault: VaultDTO
): vault is VaultDTO & {
  encryptionVersion: number;
  kekSalt: string;
  kekIterations: number;
  kekHash: string;
  wrappedDekCiphertext: string;
  wrappedDekIv: string;
} {
  return (
    vault.encryptionVersion !== null &&
    vault.kekSalt !== null &&
    vault.kekIterations !== null &&
    vault.kekHash !== null &&
    vault.wrappedDekCiphertext !== null &&
    vault.wrappedDekIv !== null
  );
}

function assertSupportedHash(hash: string): asserts hash is "SHA-256" {
  if (hash !== "SHA-256") {
    throw new Error(`Unsupported KEK hash algorithm: ${hash}`);
  }
}

/**
 * Derives the KEK from the given password and this vault's stored KDF
 * params, then unwraps and returns the vault's DEK. Rejects (throws) if
 * the password is wrong or the wrapped DEK has been tampered with — AES-
 * GCM's auth tag makes both cases indistinguishable and undecryptable,
 * which is exactly the property we want here.
 */
export async function unwrapVaultDek(
  vault: VaultDTO,
  password: string
): Promise<CryptoKey> {
  if (!hasEncryptionEnvelope(vault)) {
    throw new Error("Vault has no encryption envelope");
  }

  assertSupportedHash(vault.kekHash);

  const { key: kek } = await deriveKek(password, {
    salt: vault.kekSalt,
    iterations: vault.kekIterations,
    hash: vault.kekHash
  });

  return unwrapKey(
    { ciphertext: vault.wrappedDekCiphertext, iv: vault.wrappedDekIv },
    kek,
    DEK_USAGES
  );
}

/**
 * Generates a brand-new DEK for a to-be-created vault, derives a fresh
 * KEK from the account password (random salt), and wraps the DEK with
 * it. The returned `envelope` is what gets sent to `POST /vaults` — the
 * server only ever sees these ciphertext/param fields, never the DEK,
 * the KEK, or the password.
 */
export async function createVaultEnvelope(
  password: string
): Promise<{ dek: CryptoKey; envelope: VaultEncryptionEnvelope }> {
  const dek = await generateAesKey();
  const { key: kek, params } = await deriveKek(password);
  const wrapped = await wrapKey(dek, kek);

  return {
    dek,
    envelope: {
      encryptionVersion: CURRENT_ENCRYPTION_VERSION,
      kekSalt: params.salt,
      kekIterations: params.iterations,
      kekHash: params.hash,
      wrappedDekCiphertext: wrapped.ciphertext,
      wrappedDekIv: wrapped.iv
    }
  };
}
