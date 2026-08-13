import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { StorageAdapter, StorageObjectMeta, StoragePutInput } from "@vaultdrop/types";
import { CountingPassThrough } from "./counting-stream.js";

export interface CloudStorageAdapterOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

/**
 * Cloud object-storage implementation of `StorageAdapter`, backed by any
 * S3-compatible service (AWS S3, Cloudflare R2, MinIO, Backblaze B2, ...).
 * Selected at runtime via STORAGE_DRIVER=cloud.
 */
export class CloudStorageAdapter implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: CloudStorageAdapterOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle ?? false,
      credentials: options.credentials
    });
  }

  async put(input: StoragePutInput): Promise<StorageObjectMeta> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.data,
        ContentType: input.contentType
      })
    );
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
    const counter = new CountingPassThrough();
    data.pipe(counter);

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: counter,
        ContentType: contentType
      }
    });

    await upload.done();

    return {
      key,
      sizeBytes: counter.bytesWritten,
      contentType
    };
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    if (!result.Body) {
      throw new Error(`Object "${key}" has no body`);
    }
    const chunks: Buffer[] = [];
    const stream = result.Body as NodeJS.ReadableStream;
    for await (const chunk of stream) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (typeof chunk === "string") {
        chunks.push(Buffer.from(chunk));
      } else {
        chunks.push(Buffer.from(chunk as Uint8Array));
      }
    }
    return Buffer.concat(chunks);
  }

  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    if (!result.Body) {
      throw new Error(`Object "${key}" has no body`);
    }
    return result.Body as NodeJS.ReadableStream;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}