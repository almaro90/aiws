import type { AttachmentId, TaskCycleId, TaskId, TaskMessageId } from "./ids.ts";

export interface Attachment {
  readonly id: AttachmentId;
  readonly taskId: TaskId;
  readonly cycleId: TaskCycleId;
  readonly messageId: TaskMessageId | null;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly createdAt: string;
}
