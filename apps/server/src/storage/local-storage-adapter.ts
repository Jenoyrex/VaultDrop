import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { StorageAdapter, StorageObjectMeta, StoragePutInput } from "@vaultdrop/types";

/**
 * Stores objects on the local filesystem rooted at `rootDir`.
 * Keys are relative paths; traversal outside the root is rejected.
 */
export class LocalStorageAdapter implements StorageAdapter {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = isAbsolute(rootDir) ? rootDir : resolve(process.cwd(), rootDir);
  }

  private resolveKeyPath(key: string): string {
    const normalizedKey = normalize(key).replace(/^([/\\])+/, "");
    const fullPath = resolve(this.rootDir, normalizedKey);
    if (!fullPath.startsWith(this.rootDir + sep) && fullPath !== this.rootDir) {
      throw new Error(`Storage key "${key}" resolves outside the storage root`);
    }
    return fullPath;
  }

  async put(input: StoragePutInput): Promise<StorageObjectMeta> {
    const fullPath = this.resolveKeyPath(input.key);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, input.data);
    return {
      key: input.key,
      sizeBytes: input.data.byteLength,
      contentType: input.contentType
    };
  }

  async putStream(
    key: string,
    data: NodeJS.ReadableStream,
    contentType: string
  ): Promise<StorageObjectMeta> {
    const fullPath = this.resolveKeyPath(key);
    await mkdir(dirname(fullPath), { recursive: true });

    const writeStream = createWriteStream(fullPath);
    await pipeline(data, writeStream);

    return {
      key,
      sizeBytes: writeStream.bytesWritten,
      contentType
    };
  }

  async get(key: string): Promise<Buffer> {
    const fullPath = this.resolveKeyPath(key);
    return readFile(fullPath);
  }

  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    const fullPath = this.resolveKeyPath(key);
    await stat(fullPath);
    return createReadStream(fullPath);
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.resolveKeyPath(key);
    await rm(fullPath, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = this.resolveKeyPath(key);
    try {
      await stat(fullPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Builds the on-disk/on-bucket storage key for a file's content.
 *
 * `fileName` is optional and must be omitted for an encrypted upload:
 * embedding the plaintext filename in the storage key would leak it into
 * the filesystem path, cloud object key, and any server logs that record
 * storage operations — defeating zero-knowledge name encryption even
 * though the DB row itself only holds ciphertext. Legacy plaintext
 * uploads keep passing `fileName` for readability/debuggability, exactly
 * as before.
 */
export function buildVaultStorageKey(vaultId: string, fileId: string, fileName?: string): string {
  return join(vaultId, fileName ? `${fileId}-${fileName}` : fileId);
}