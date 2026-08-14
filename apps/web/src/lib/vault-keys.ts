/**
 * Glue between the app (VaultDTO from the API) and the browser-only crypto
 * primitives in `lib/crypto/`. Every function here runs entirely
 * client-side: the password, the derived KEK, and the unwrapped DEK never
 * leave the browser and are never sent to the server.
 */
import type {
  RecoveryEnvelopeResponse,
  VaultDTO,
  VaultEncryptionEnvelope,
  VaultPasswordRewrap
} from "@vaultdrop/types";
import {
  deriveKek,
  wrapKey,
  unwrapKey,
  generateAesKey,
  generateRecoveryKey,
  parseRecoveryKey,
  importAesKeyRaw
} from "@/lib/crypto";

/** DEK key usages needed to later wrap/unwrap per-file keys and, in a
 * future checkpoint, encrypt/decrypt file content directly. */
const DEK_USAGES: KeyUsage[] = ["encrypt", "decrypt", "wrapKey", "unwrapKey"];

/** A recovery key is only ever used to wrap/unwrap the DEK, never to
 * encrypt/decrypt anything directly. */
const RECOVERY_KEY_USAGES: KeyUsage[] = ["wrapKey", "unwrapKey"];

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
 * Derives a fresh KEK from `password` (random salt) and wraps `dek` with
 * it. Shared by `createVaultEnvelope` (brand-new DEK) and the post-recovery
 * "restore password unlock" flow (an already-recovered DEK) — both cases
 * produce the same envelope shape for `PUT/POST .../encryption`. Callers
 * are responsible for `password` actually being the user's current
 * account password; this function has no way to check that itself.
 */
export async function rewrapVaultDekWithPassword(
  dek: CryptoKey,
  password: string
): Promise<VaultEncryptionEnvelope> {
  const { key: kek, params } = await deriveKek(password);
  const wrapped = await wrapKey(dek, kek);

  return {
    encryptionVersion: CURRENT_ENCRYPTION_VERSION,
    kekSalt: params.salt,
    kekIterations: params.iterations,
    kekHash: params.hash,
    wrappedDekCiphertext: wrapped.ciphertext,
    wrappedDekIv: wrapped.iv
  };
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
  const envelope = await rewrapVaultDekWithPassword(dek, password);
  return { dek, envelope };
}

/**
 * Generates a brand-new recovery key and wraps `dek` with it directly
 * (no KDF — the recovery key already has full 256-bit entropy, so
 * deriving further from it would add nothing). Returns the formatted key
 * to show the user exactly once, plus the ciphertext envelope to send to
 * `PUT /vaults/:id/recovery-key`. The recovery key itself is never
 * returned to a caller that could persist it — it exists only as this
 * function's local, transient state.
 */
export async function createRecoveryEnvelope(
  dek: CryptoKey
): Promise<{ recoveryKey: string; envelope: RecoveryEnvelopeResponse }> {
  const { bytes, formatted } = generateRecoveryKey();
  const recoveryKey = await importAesKeyRaw(bytes, RECOVERY_KEY_USAGES);
  const wrapped = await wrapKey(dek, recoveryKey);

  return {
    recoveryKey: formatted,
    envelope: {
      recoveryWrappedDekCiphertext: wrapped.ciphertext,
      recoveryWrappedDekIv: wrapped.iv
    }
  };
}

/**
 * Unwraps a vault's DEK using a user-supplied recovery key string against
 * the vault's stored recovery envelope. Rejects (throws) if the recovery
 * key is malformed, wrong, or the envelope has been tampered with — same
 * indistinguishable failure mode as a wrong password in `unwrapVaultDek`.
 * Never involves the account password.
 */
export async function unwrapVaultDekWithRecoveryKey(
  envelope: RecoveryEnvelopeResponse,
  recoveryKeyInput: string
): Promise<CryptoKey> {
  const bytes = parseRecoveryKey(recoveryKeyInput);
  const recoveryKey = await importAesKeyRaw(bytes, RECOVERY_KEY_USAGES);

  return unwrapKey(
    {
      ciphertext: envelope.recoveryWrappedDekCiphertext,
      iv: envelope.recoveryWrappedDekIv
    },
    recoveryKey,
    DEK_USAGES
  );
}

/** Thrown by `prepareVaultRewrapsForPasswordChange` when *every* encrypted
 * vault fails to unwrap with the given current password — the only
 * explanation, since a correct password unwraps every non-corrupted
 * vault identically (they all derive from the same account credential). */
export class IncorrectPasswordError extends Error {
  constructor() {
    super("Current password is incorrect");
    this.name = "IncorrectPasswordError";
  }
}

/** Thrown when *some but not all* encrypted vaults fail to unwrap — proof
 * the password itself is correct (it worked for the others), so the
 * failing vault's own stored envelope is the problem, not the password. */
export class CorruptedVaultError extends Error {
  public readonly vaultId: string;
  public readonly vaultName: string;

  constructor(vaultId: string, vaultName: string) {
    super(
      `Vault "${vaultName}" could not be unwrapped with the current password — its data may be corrupted`
    );
    this.name = "CorruptedVaultError";
    this.vaultId = vaultId;
    this.vaultName = vaultName;
  }
}

/**
 * Prepares the payload for `PUT /auth/password`: for every encrypted
 * vault, unwraps its DEK with `currentPassword` and re-wraps the *same*
 * DEK with `newPassword` — file content and names are never touched,
 * only the DEK's wrapping. `encryptedVaults` must already be filtered to
 * vaults with an encryption envelope (see `hasEncryptionEnvelope`);
 * legacy vaults have nothing to rewrap and must not be passed in.
 *
 * Fails closed, before producing or sending anything: if every vault
 * fails to unwrap, the current password itself is wrong
 * (`IncorrectPasswordError`). If only some fail, the password is proven
 * correct (it worked for the others) and the failing vault's stored data
 * is the problem (`CorruptedVaultError`, naming that vault) — in neither
 * case is a partial result ever returned.
 */
export async function prepareVaultRewrapsForPasswordChange(
  encryptedVaults: VaultDTO[],
  currentPassword: string,
  newPassword: string
): Promise<VaultPasswordRewrap[]> {
  if (encryptedVaults.length === 0) {
    return [];
  }

  const results = await Promise.allSettled(
    encryptedVaults.map((vault) => unwrapVaultDek(vault, currentPassword))
  );

  const paired = encryptedVaults.map((vault, index) => ({
    vault,
    result: results[index] as PromiseSettledResult<CryptoKey>
  }));

  const failed = paired.filter((entry) => entry.result.status === "rejected");

  if (failed.length === paired.length) {
    throw new IncorrectPasswordError();
  }

  if (failed.length > 0) {
    const broken = failed[0]!.vault;
    throw new CorruptedVaultError(broken.id, broken.name);
  }

  const rewraps: VaultPasswordRewrap[] = [];
  for (const entry of paired) {
    const dek = (entry.result as PromiseFulfilledResult<CryptoKey>).value;
    const envelope = await rewrapVaultDekWithPassword(dek, newPassword);
    rewraps.push({ vaultId: entry.vault.id, ...envelope });
  }

  return rewraps;
}
