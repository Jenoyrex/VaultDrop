import { Transform } from "node:stream";

/**
 * A pass-through stream that counts bytes as they flow through it,
 * unmodified. Used to learn the total size of a streamed upload whose
 * length wasn't known in advance (e.g. `@aws-sdk/lib-storage`'s `Upload`
 * helper doesn't hand back a byte count on its own).
 */
export class CountingPassThrough extends Transform {
  private _bytesWritten = 0;

  get bytesWritten(): number {
    return this._bytesWritten;
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void
  ): void {
    this._bytesWritten += chunk.length;
    callback(null, chunk);
  }
}