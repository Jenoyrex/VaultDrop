/**
 * Contract that every storage backend (local disk, S3, GCS, etc.) must
 * implement. The rest of the server only ever depends on this interface,
 * never on a concrete adapter, so swapping providers never touches
 * business logic.
 */

export interface StoragePutInput {
  /** Stable, unique key under which the object will be stored. */
  key: string;
  /** Raw bytes to persist. */
  data: Buffer;
  /** MIME type of the object, stored as metadata where supported. */
  contentType: string;
}

export interface StorageObjectMeta {
  key: string;
  sizeBytes: number;
  contentType: string;
}

export interface StorageAdapter {
  /** Persist an object and return its metadata as actually stored. */
  put(input: StoragePutInput): Promise<StorageObjectMeta>;

  /** Retrieve the full contents of an object as a Buffer. */
  get(key: string): Promise<Buffer>;

  /** Open a readable stream for an object (used for download/preview). */
  getStream(key: string): Promise<NodeJS.ReadableStream>;

  /** Permanently remove an object. Resolves even if the object is absent. */
  delete(key: string): Promise<void>;

  /** Check whether an object exists. */
  exists(key: string): Promise<boolean>;
}
