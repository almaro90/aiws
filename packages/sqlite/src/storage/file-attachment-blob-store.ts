import {
  AttachmentTooLargeError,
  type AttachmentBlobStore,
  type QuarantinedBlob,
  type StagedBlob,
  StorageError,
  UnsupportedMediaTypeError,
  type UploadLimits,
  ValidationError,
} from "@aiws/core";
import { chmod, lstat, mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve, sep, win32 } from "node:path";

type Format = {
  readonly mimeType: string;
  readonly kind: "text" | "png" | "jpeg" | "webp" | "gif" | "pdf";
};

const formats = new Map<string, Format>([
  [".png", { mimeType: "image/png", kind: "png" }],
  [".jpg", { mimeType: "image/jpeg", kind: "jpeg" }],
  [".jpeg", { mimeType: "image/jpeg", kind: "jpeg" }],
  [".webp", { mimeType: "image/webp", kind: "webp" }],
  [".gif", { mimeType: "image/gif", kind: "gif" }],
  [".pdf", { mimeType: "application/pdf", kind: "pdf" }],
  [".txt", { mimeType: "text/plain", kind: "text" }],
  [".log", { mimeType: "text/plain", kind: "text" }],
  [".md", { mimeType: "text/markdown", kind: "text" }],
  [".markdown", { mimeType: "text/markdown", kind: "text" }],
  [".json", { mimeType: "application/json", kind: "text" }],
  [".jsonl", { mimeType: "application/json", kind: "text" }],
  [".csv", { mimeType: "text/csv", kind: "text" }],
  [".tsv", { mimeType: "text/tab-separated-values", kind: "text" }],
  [".xml", { mimeType: "application/xml", kind: "text" }],
  [".yaml", { mimeType: "application/yaml", kind: "text" }],
  [".yml", { mimeType: "application/yaml", kind: "text" }],
]);

export class FileAttachmentBlobStore implements AttachmentBlobStore {
  readonly #attachmentsDirectory: string;
  readonly #uploadsDirectory: string;
  readonly #quarantineDirectory: string;

  private constructor(private readonly dataDirectory: string) {
    this.#attachmentsDirectory = join(dataDirectory, "attachments");
    this.#uploadsDirectory = join(dataDirectory, "tmp", "uploads");
    this.#quarantineDirectory = join(dataDirectory, "tmp", "quarantine");
  }

  static async create(dataDirectory: string): Promise<FileAttachmentBlobStore> {
    if (!isAbsolute(dataDirectory)) throw new StorageError("Data directory must be absolute.");
    const store = new FileAttachmentBlobStore(resolve(dataDirectory));
    await mkdir(store.#attachmentsDirectory, { recursive: true, mode: 0o700 });
    await mkdir(store.#uploadsDirectory, { recursive: true, mode: 0o700 });
    await mkdir(store.#quarantineDirectory, { recursive: true, mode: 0o700 });
    await Promise.all([
      chmod(store.dataDirectory, 0o700),
      chmod(store.#attachmentsDirectory, 0o700),
      chmod(store.#uploadsDirectory, 0o700),
      chmod(store.#quarantineDirectory, 0o700),
    ]);
    return store;
  }

  async stage(input: ReadableStream<Uint8Array>, limits: UploadLimits): Promise<StagedBlob> {
    const originalName = safeBasename(limits.originalName);
    const format = formatFor(originalName, limits.declaredMimeType);
    const token = crypto.randomUUID();
    const path = join(this.#uploadsDirectory, token);
    const handle = await open(path, "wx", 0o600).catch((error) => {
      throw storageError(error);
    });
    const reader = input.getReader();
    const hasher = new Bun.CryptoHasher("sha256");
    const prefix = new Uint8Array(16);
    let prefixLength = 0;
    let sizeBytes = 0;
    const textDecoder: TextDecoder | null =
      format.kind === "text" ? new TextDecoder("utf-8", { fatal: true }) : null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.byteLength === 0) continue;
        sizeBytes += value.byteLength;
        if (sizeBytes > limits.maximumBytes) throw new AttachmentTooLargeError(limits.maximumBytes);
        hasher.update(value);
        if (prefixLength < prefix.byteLength) {
          const copied = Math.min(prefix.byteLength - prefixLength, value.byteLength);
          prefix.set(value.subarray(0, copied), prefixLength);
          prefixLength += copied;
        }
        if (textDecoder !== null) {
          if (value.includes(0))
            throw new UnsupportedMediaTypeError("Text attachments cannot contain NUL bytes.");
          try {
            textDecoder.decode(value, { stream: true });
          } catch {
            throw new UnsupportedMediaTypeError("Text attachments must contain valid UTF-8.");
          }
        }
        await writeAll(handle, value);
      }
      if (sizeBytes === 0)
        throw new UnsupportedMediaTypeError("Empty attachments are not allowed.");
      if (textDecoder !== null) {
        try {
          textDecoder.decode();
        } catch {
          throw new UnsupportedMediaTypeError("Text attachments must contain valid UTF-8.");
        }
      } else if (!magicMatches(format.kind, prefix.subarray(0, prefixLength))) {
        throw new UnsupportedMediaTypeError("Attachment content does not match its file type.");
      }
      await handle.sync();
      await handle.close();
      return {
        token,
        originalName,
        mimeType: format.mimeType,
        sizeBytes,
        sha256: hasher.digest("hex"),
      };
    } catch (error) {
      reader.cancel().catch(() => {});
      await handle.close().catch(() => {});
      await unlink(path).catch(() => {});
      if (
        error instanceof AttachmentTooLargeError ||
        error instanceof UnsupportedMediaTypeError ||
        error instanceof ValidationError
      ) {
        throw error;
      }
      throw storageError(error);
    }
  }

  async commit(staged: StagedBlob, storageKey: string): Promise<void> {
    const source = join(this.#uploadsDirectory, staged.token);
    const target = this.pathForStorageKey(storageKey);
    let moved = false;
    try {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await rename(source, target);
      moved = true;
      await chmod(target, 0o600);
    } catch (error) {
      if (moved) await rename(target, source).catch(() => unlink(target).catch(() => {}));
      throw storageError(error);
    }
  }

  async open(storageKey: string): Promise<ReadableStream<Uint8Array>> {
    const path = this.pathForStorageKey(storageKey);
    try {
      const details = await lstat(path);
      if (!details.isFile() || details.isSymbolicLink())
        throw new Error("Blob is not a regular file.");
      return Bun.file(path).stream() as ReadableStream<Uint8Array>;
    } catch (error) {
      throw storageError(error);
    }
  }

  async quarantine(storageKey: string): Promise<QuarantinedBlob> {
    const encodedKey = Buffer.from(storageKey).toString("base64url");
    const token = `${encodedKey}.${crypto.randomUUID()}`;
    try {
      await rename(this.pathForStorageKey(storageKey), join(this.#quarantineDirectory, token));
      return { token, storageKey };
    } catch (error) {
      throw storageError(error);
    }
  }

  async restore(blob: QuarantinedBlob): Promise<void> {
    const target = this.pathForStorageKey(blob.storageKey);
    try {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await rename(join(this.#quarantineDirectory, blob.token), target);
      await chmod(target, 0o600);
    } catch (error) {
      throw storageError(error);
    }
  }

  async purge(blob: QuarantinedBlob): Promise<void> {
    try {
      await unlink(join(this.#quarantineDirectory, blob.token));
    } catch (error) {
      throw storageError(error);
    }
  }

  async discard(staged: StagedBlob): Promise<void> {
    try {
      await unlink(join(this.#uploadsDirectory, staged.token));
    } catch (error) {
      if (isMissing(error)) return;
      throw storageError(error);
    }
  }

  async cleanupOrphans(
    olderThan: Date,
    isReferenced: (storageKey: string) => boolean | Promise<boolean>,
  ): Promise<void> {
    await this.cleanupUploads(olderThan);
    const entries = await readdir(this.#quarantineDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(this.#quarantineDirectory, entry.name);
      if (!(await isOlder(path, olderThan))) continue;
      if (!entry.isFile()) {
        await unlink(path).catch(() => {});
        continue;
      }
      const storageKey = decodeStorageKey(entry.name);
      if (storageKey !== null && (await isReferenced(storageKey))) {
        await this.restore({ token: entry.name, storageKey });
      } else {
        await unlink(path);
      }
    }
  }

  private async cleanupUploads(olderThan: Date): Promise<void> {
    const entries = await readdir(this.#uploadsDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(this.#uploadsDirectory, entry.name);
      if (await isOlder(path, olderThan)) await unlink(path).catch(() => {});
    }
  }

  private pathForStorageKey(storageKey: string): string {
    if (!/^attachments\/tsk_[0-9A-HJKMNP-TV-Z]{26}\/att_[0-9A-HJKMNP-TV-Z]{26}$/.test(storageKey)) {
      throw new StorageError("Attachment storage key is invalid.");
    }
    const path = resolve(this.dataDirectory, storageKey);
    if (!path.startsWith(`${this.dataDirectory}${sep}`)) {
      throw new StorageError("Attachment storage key escapes the data directory.");
    }
    return path;
  }
}

function safeBasename(value: string): string {
  const name = basename(win32.basename(value)).trim();
  const length = Array.from(name).length;
  if (length < 1 || length > 255 || name === "." || name === "..") {
    throw new ValidationError([
      { path: "file.name", message: "Must contain between 1 and 255 basename characters." },
    ]);
  }
  return name;
}

function formatFor(originalName: string, declaredMimeType: string): Format {
  const format = formats.get(extname(originalName).toLowerCase());
  if (format === undefined) throw new UnsupportedMediaTypeError();
  const declared = declaredMimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (declared !== "" && declared !== "application/octet-stream" && declared !== format.mimeType) {
    throw new UnsupportedMediaTypeError("Declared MIME type does not match the file extension.");
  }
  return format;
}

function magicMatches(kind: Format["kind"], bytes: Uint8Array): boolean {
  const starts = (...expected: number[]) => expected.every((byte, index) => bytes[index] === byte);
  switch (kind) {
    case "png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "webp":
      return (
        starts(0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    case "gif":
      return (
        new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF87a" ||
        new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF89a"
      );
    case "pdf":
      return starts(0x25, 0x50, 0x44, 0x46, 0x2d);
    case "text":
      return true;
  }
}

function storageError(error: unknown): StorageError {
  return error instanceof StorageError ? error : new StorageError();
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function isOlder(path: string, threshold: Date): Promise<boolean> {
  try {
    return (await stat(path)).mtimeMs < threshold.getTime();
  } catch {
    return false;
  }
}

function decodeStorageKey(token: string): string | null {
  const encoded = token.split(".", 1)[0];
  if (encoded === undefined) return null;
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  value: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < value.byteLength) {
    const result = await handle.write(value, offset, value.byteLength - offset);
    if (result.bytesWritten < 1) throw new Error("Attachment write made no progress.");
    offset += result.bytesWritten;
  }
}
