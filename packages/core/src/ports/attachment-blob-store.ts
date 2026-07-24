export interface UploadLimits {
  readonly maximumBytes: number;
  readonly originalName: string;
  readonly declaredMimeType: string;
}

export interface StagedBlob {
  readonly token: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface QuarantinedBlob {
  readonly token: string;
  readonly storageKey: string;
}

export interface AttachmentBlobStore {
  stage(input: ReadableStream<Uint8Array>, limits: UploadLimits): Promise<StagedBlob>;
  commit(staged: StagedBlob, storageKey: string): Promise<void>;
  open(storageKey: string): Promise<ReadableStream<Uint8Array>>;
  quarantine(storageKey: string): Promise<QuarantinedBlob>;
  restore(blob: QuarantinedBlob): Promise<void>;
  purge(blob: QuarantinedBlob): Promise<void>;
  discard(staged: StagedBlob): Promise<void>;
}
