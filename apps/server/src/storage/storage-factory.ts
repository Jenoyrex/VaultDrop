import type { ServerEnv } from "@vaultdrop/config";
import type { StorageAdapter } from "@vaultdrop/types";
import { LocalStorageAdapter } from "./local-storage-adapter.js";
import { CloudStorageAdapter } from "./cloud-storage-adapter.js";

export function createStorageAdapter(env: ServerEnv): StorageAdapter {
  if (env.STORAGE_DRIVER === "cloud") {
    const bucket = process.env["CLOUD_STORAGE_BUCKET"];
    const region = process.env["CLOUD_STORAGE_REGION"];
    if (!bucket || !region) {
      throw new Error(
        "CLOUD_STORAGE_BUCKET and CLOUD_STORAGE_REGION are required when STORAGE_DRIVER=cloud"
      );
    }
    const accessKeyId = process.env["CLOUD_STORAGE_ACCESS_KEY_ID"];
    const secretAccessKey = process.env["CLOUD_STORAGE_SECRET_ACCESS_KEY"];
    return new CloudStorageAdapter({
      bucket,
      region,
      endpoint: process.env["CLOUD_STORAGE_ENDPOINT"],
      forcePathStyle: process.env["CLOUD_STORAGE_FORCE_PATH_STYLE"] === "true",
      credentials:
        accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined
    });
  }
  return new LocalStorageAdapter(env.STORAGE_ROOT);
}
