export interface ValidationIssue {
  path: string;
  message: string;
}

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(issues: readonly ValidationIssue[]) {
    super("Input validation failed.", "validation_error", { fields: issues });
  }
}

export class NotFoundError extends DomainError {
  constructor(
    resource:
      | "Project"
      | "Task"
      | "Question"
      | "Attachment"
      | "Connection"
      | "AgentProfile"
      | "Run",
    id: string,
  ) {
    super(`${resource} was not found.`, "not_found", { resource, id });
  }
}

export class AttachmentTooLargeError extends DomainError {
  constructor(maximumBytes: number) {
    super("Attachment exceeds the configured size limit.", "attachment_too_large", {
      maximumBytes,
    });
  }
}

export class AttachmentLimitReachedError extends DomainError {
  constructor(maximumAttachments: number) {
    super("Task has reached the attachment limit.", "attachment_limit_reached", {
      maximumAttachments,
    });
  }
}

export class UnsupportedMediaTypeError extends DomainError {
  constructor(message = "Attachment type is not supported.") {
    super(message, "unsupported_media_type");
  }
}

export class StorageError extends DomainError {
  constructor(message = "Attachment storage operation failed.") {
    super(message, "storage_error");
  }
}

export class VersionConflictError extends DomainError {
  constructor(expectedVersion: number, currentVersion?: number) {
    super("Task version does not match.", "version_conflict", {
      expectedVersion,
      ...(currentVersion === undefined ? {} : { currentVersion }),
    });
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, "invalid_transition", details);
  }
}

export class ProjectHasActiveTasksError extends DomainError {
  constructor(projectId: string) {
    super("Project has active tasks.", "project_has_active_tasks", { projectId });
  }
}
