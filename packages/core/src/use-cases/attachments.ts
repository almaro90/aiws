import type { Attachment } from "../domain/attachment.ts";
import type { ActorType, TaskEventFact } from "../domain/task-event.ts";
import { mutateTaskForAttachment, type Task } from "../domain/task.ts";
import {
  AttachmentLimitReachedError,
  NotFoundError,
  StorageError,
  VersionConflictError,
} from "../errors/domain-errors.ts";
import type { AttachmentId, TaskId } from "../domain/ids.ts";
import type {
  AttachmentBlobStore,
  QuarantinedBlob,
  StagedBlob,
} from "../ports/attachment-blob-store.ts";
import type { Stores, StoredAttachment } from "../ports/stores.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { assertExpectedVersion, type CoreDependencies, eventFor, timestamp } from "./context.ts";

export interface AddAttachmentInput {
  readonly taskId: TaskId;
  readonly expectedVersion: number;
  readonly originalName: string;
  readonly declaredMimeType: string;
  readonly content: ReadableStream<Uint8Array>;
  readonly actorType: ActorType;
}

export interface RemoveAttachmentInput {
  readonly taskId: TaskId;
  readonly attachmentId: AttachmentId;
  readonly expectedVersion: number;
  readonly actorType: ActorType;
}

export interface AttachmentMutationResult {
  readonly attachment: Attachment;
  readonly taskVersion: number;
}

export interface OpenAttachmentResult {
  readonly attachment: Attachment;
  readonly content: ReadableStream<Uint8Array>;
}

export class AttachmentUseCases {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly blobs: AttachmentBlobStore,
    private readonly dependencies: CoreDependencies,
    private readonly limits: {
      readonly maximumAttachmentsPerTask: number;
      readonly maximumAttachmentBytes: number;
    },
  ) {}

  async list(taskId: TaskId): Promise<readonly Attachment[]> {
    return this.unitOfWork.execute(async (stores) => {
      await this.loadTask(stores, taskId);
      return (await stores.attachments.listByTaskId(taskId)).map(publicAttachment);
    });
  }

  async get(taskId: TaskId, attachmentId: AttachmentId): Promise<Attachment> {
    return this.unitOfWork.execute(async (stores) => {
      await this.loadTask(stores, taskId);
      return publicAttachment(await this.loadAttachment(stores, taskId, attachmentId));
    });
  }

  async openContent(taskId: TaskId, attachmentId: AttachmentId): Promise<OpenAttachmentResult> {
    const attachment = await this.unitOfWork.execute(async (stores) => {
      await this.loadTask(stores, taskId);
      return this.loadAttachment(stores, taskId, attachmentId);
    });
    return {
      attachment: publicAttachment(attachment),
      content: await this.blobs.open(attachment.storageKey),
    };
  }

  async add(input: AddAttachmentInput): Promise<AttachmentMutationResult> {
    const staged = await this.blobs.stage(input.content, {
      maximumBytes: this.limits.maximumAttachmentBytes,
      originalName: input.originalName,
      declaredMimeType: input.declaredMimeType,
    });
    const attachmentId = this.dependencies.ids.attachmentId();
    const storageKey = `attachments/${input.taskId}/${attachmentId}`;
    let committed = false;
    try {
      const result = await this.unitOfWork.execute(async (stores) => {
        const current = await this.loadTask(stores, input.taskId);
        assertExpectedVersion(current, input.expectedVersion);
        if (
          (await stores.attachments.countByTaskId(input.taskId)) >=
          this.limits.maximumAttachmentsPerTask
        ) {
          throw new AttachmentLimitReachedError(this.limits.maximumAttachmentsPerTask);
        }
        const now = timestamp(this.dependencies.clock);
        const task = mutateTaskForAttachment(current, now);
        const attachment: StoredAttachment = {
          id: attachmentId,
          taskId: input.taskId,
          cycleId: current.currentCycleId,
          messageId: null,
          originalName: staged.originalName,
          storageKey,
          mimeType: staged.mimeType,
          sizeBytes: staged.sizeBytes,
          sha256: staged.sha256,
          createdAt: now,
        };
        await this.blobs.commit(staged, storageKey);
        committed = true;
        await stores.attachments.insert(attachment);
        await this.persistMutation(
          stores,
          task,
          input.expectedVersion,
          {
            type: "attachment_added",
            attachmentId,
            originalName: attachment.originalName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          },
          input.actorType,
          now,
        );
        return { attachment: publicAttachment(attachment), taskVersion: task.version };
      });
      return result;
    } catch (error) {
      await this.cleanupFailedAdd(staged, storageKey, committed);
      throw error;
    }
  }

  async remove(input: RemoveAttachmentInput): Promise<{ readonly taskVersion: number }> {
    let quarantined: QuarantinedBlob | null = null;
    try {
      const result = await this.unitOfWork.execute(async (stores) => {
        const current = await this.loadTask(stores, input.taskId);
        assertExpectedVersion(current, input.expectedVersion);
        const attachment = await this.loadAttachment(stores, input.taskId, input.attachmentId);
        const now = timestamp(this.dependencies.clock);
        const task = mutateTaskForAttachment(current, now);
        quarantined = await this.blobs.quarantine(attachment.storageKey);
        if (!(await stores.attachments.remove(attachment.id, attachment.taskId))) {
          throw new NotFoundError("Attachment", attachment.id);
        }
        await this.persistMutation(
          stores,
          task,
          input.expectedVersion,
          {
            type: "attachment_removed",
            attachmentId: attachment.id,
            originalName: attachment.originalName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          },
          input.actorType,
          now,
        );
        return { taskVersion: task.version };
      });
      if (quarantined !== null) await this.bestEffortPurge(quarantined);
      return result;
    } catch (error) {
      if (quarantined !== null) {
        try {
          await this.blobs.restore(quarantined);
        } catch {
          throw new StorageError("Attachment could not be restored after a database failure.");
        }
      }
      throw error;
    }
  }

  private async loadTask(stores: Stores, taskId: TaskId): Promise<Task> {
    const task = await stores.tasks.getById(taskId);
    if (task === null) throw new NotFoundError("Task", taskId);
    return task;
  }

  private async loadAttachment(
    stores: Stores,
    taskId: TaskId,
    attachmentId: AttachmentId,
  ): Promise<StoredAttachment> {
    const attachment = await stores.attachments.getById(attachmentId);
    if (attachment === null || attachment.taskId !== taskId) {
      throw new NotFoundError("Attachment", attachmentId);
    }
    return attachment;
  }

  private async persistMutation(
    stores: Stores,
    task: Task,
    expectedVersion: number,
    fact: TaskEventFact,
    actorType: ActorType,
    now: string,
  ): Promise<void> {
    if (!(await stores.tasks.updateIfVersion(task, expectedVersion))) {
      throw new VersionConflictError(expectedVersion);
    }
    await stores.events.append([await eventFor(task, actorType, fact, this.dependencies, now)]);
  }

  private async cleanupFailedAdd(
    staged: StagedBlob,
    storageKey: string,
    committed: boolean,
  ): Promise<void> {
    try {
      if (!committed) {
        await this.blobs.discard(staged);
        return;
      }
      const blob = await this.blobs.quarantine(storageKey);
      await this.blobs.purge(blob);
    } catch {
      throw new StorageError("Attachment blob cleanup failed.");
    }
  }

  private async bestEffortPurge(blob: QuarantinedBlob): Promise<void> {
    try {
      await this.blobs.purge(blob);
    } catch {
      // Startup cleanup will purge committed deletion leftovers.
    }
  }
}

function publicAttachment(attachment: StoredAttachment): Attachment {
  return {
    id: attachment.id,
    taskId: attachment.taskId,
    cycleId: attachment.cycleId,
    messageId: attachment.messageId,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    sha256: attachment.sha256,
    createdAt: attachment.createdAt,
  };
}
