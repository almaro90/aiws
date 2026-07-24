import {
  AttachmentLimitReachedError,
  AttachmentTooLargeError,
  type DomainError,
  InvalidTransitionError,
  NotFoundError,
  ProjectHasActiveTasksError,
  StorageError,
  UnsupportedMediaTypeError,
  ValidationError,
  VersionConflictError,
} from "@aiws/core";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
    readonly headers?: Readonly<Record<string, string>>,
  ) {
    super(message);
  }
}

export function domainStatus(error: DomainError): number {
  if (error instanceof AttachmentTooLargeError) return 413;
  if (error instanceof UnsupportedMediaTypeError) return 415;
  if (error instanceof AttachmentLimitReachedError) return 422;
  if (error instanceof ValidationError) return 422;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof VersionConflictError) return 409;
  if (error instanceof InvalidTransitionError) return 409;
  if (error instanceof ProjectHasActiveTasksError) return 409;
  if (error instanceof StorageError) return 500;
  return 500;
}
