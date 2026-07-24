import type { ActorType, TaskEventFact } from "../domain/task-event.ts";
import type { TaskMessage, TimelinePage } from "../domain/cycle.ts";
import type { TaskId } from "../domain/ids.ts";
import {
  AttachmentLimitReachedError,
  InvalidTransitionError,
  NotFoundError,
  StorageError,
  VersionConflictError,
  ValidationError,
} from "../errors/domain-errors.ts";
import type { AttachmentBlobStore, StagedBlob } from "../ports/attachment-blob-store.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { assertExpectedVersion, type CoreDependencies, eventFor, timestamp } from "./context.ts";

export class MessageUseCases {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly blobs: AttachmentBlobStore,
    private readonly dependencies: CoreDependencies,
    private readonly limits: {
      readonly maximumAttachmentsPerTask: number;
      readonly maximumAttachmentBytes: number;
    },
  ) {}

  async create(input: {
    readonly taskId: TaskId;
    readonly expectedVersion: number;
    readonly text?: string | null;
    readonly attachments: readonly {
      readonly originalName: string;
      readonly declaredMimeType: string;
      readonly content: ReadableStream<Uint8Array>;
    }[];
    readonly actorType: ActorType;
  }): Promise<{ readonly message: TaskMessage; readonly taskVersion: number }> {
    const text = input.text?.trim() ? input.text : null;
    if (
      (text === null && input.attachments.length === 0) ||
      (text !== null && Array.from(text).length > 100_000)
    ) {
      throw new ValidationError([
        { path: "text", message: "A message requires text or at least one attachment." },
      ]);
    }
    const staged: StagedBlob[] = [];
    const committed: string[] = [];
    try {
      for (const file of input.attachments)
        staged.push(
          await this.blobs.stage(file.content, {
            maximumBytes: this.limits.maximumAttachmentBytes,
            originalName: file.originalName,
            declaredMimeType: file.declaredMimeType,
          }),
        );
      return await this.unitOfWork.execute(async (stores) => {
        const current = await stores.tasks.getById(input.taskId);
        if (current === null) throw new NotFoundError("Task", input.taskId);
        assertExpectedVersion(current, input.expectedVersion);
        if (
          current.archivedAt !== null ||
          (current.status !== "done" && current.status !== "blocked")
        ) {
          throw new InvalidTransitionError("Messages can only be added to Done or Blocked Tasks.", {
            currentStatus: current.status,
          });
        }
        const now = timestamp(this.dependencies.clock);
        const newCycle = current.status === "done";
        const cycleId = newCycle ? this.dependencies.ids.cycleId() : current.currentCycleId;
        if (newCycle) {
          const previous = await stores.cycles.getById(current.currentCycleId);
          if (previous !== null && previous.completedAt === null)
            await stores.cycles.update({ ...previous, completedAt: now });
          await stores.cycles.insert({
            id: cycleId,
            taskId: current.id,
            number: await stores.cycles.nextNumber(current.id),
            deliveryId: current.currentDeliveryId,
            createdAt: now,
            completedAt: null,
          });
        }
        if (
          (await stores.attachments.countByTaskId(current.id)) + staged.length >
          this.limits.maximumAttachmentsPerTask
        )
          throw new AttachmentLimitReachedError(this.limits.maximumAttachmentsPerTask);
        const message: TaskMessage = {
          id: this.dependencies.ids.messageId(),
          taskId: current.id,
          cycleId,
          type: newCycle ? "change" : "context",
          text,
          createdAt: now,
        };
        const task = {
          ...current,
          currentCycleId: cycleId,
          status: newCycle ? ("curating" as const) : current.status,
          automationPaused: newCycle ? false : current.automationPaused,
          version: current.version + 1,
          updatedAt: now,
        };
        if (!(await stores.tasks.updateIfVersion(task, input.expectedVersion)))
          throw new VersionConflictError(input.expectedVersion);
        await stores.messages.insert(message);
        const addedAttachments: {
          id: import("../domain/ids.ts").AttachmentId;
          originalName: string;
          mimeType: string;
          sizeBytes: number;
        }[] = [];
        for (const blob of staged) {
          const id = this.dependencies.ids.attachmentId();
          const storageKey = `attachments/${current.id}/${id}`;
          await this.blobs.commit(blob, storageKey);
          committed.push(storageKey);
          await stores.attachments.insert({
            id,
            taskId: current.id,
            cycleId,
            messageId: message.id,
            originalName: blob.originalName,
            storageKey,
            mimeType: blob.mimeType,
            sizeBytes: blob.sizeBytes,
            sha256: blob.sha256,
            createdAt: now,
          });
          addedAttachments.push({
            id,
            originalName: blob.originalName,
            mimeType: blob.mimeType,
            sizeBytes: blob.sizeBytes,
          });
        }
        const facts: TaskEventFact[] = [];
        if (newCycle) {
          const cycle = await stores.cycles.getById(cycleId);
          facts.push({ type: "cycle_created", cycleId, number: cycle?.number ?? 1 });
        }
        facts.push({
          type: "message_created",
          messageId: message.id,
          cycleId,
          messageType: message.type,
          attachmentCount: input.attachments.length,
        });
        for (const attachment of addedAttachments)
          facts.push({
            type: "attachment_added",
            attachmentId: attachment.id,
            originalName: attachment.originalName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          });
        if (newCycle)
          facts.push({
            type: "status_changed",
            from: "done",
            to: "curating",
            automatic: true,
            reason: "Incremental change requested.",
          });
        await stores.events.append(
          await Promise.all(
            facts.map((fact) => eventFor(task, input.actorType, fact, this.dependencies, now)),
          ),
        );
        return { message, taskVersion: task.version };
      });
    } catch (error) {
      for (const blob of staged.slice(committed.length))
        await this.blobs.discard(blob).catch(() => undefined);
      for (const storageKey of committed) {
        const quarantined = await this.blobs.quarantine(storageKey).catch(() => null);
        if (quarantined !== null) await this.blobs.purge(quarantined).catch(() => undefined);
      }
      if (error instanceof Error) throw error;
      throw new StorageError("Message attachments could not be stored.");
    }
  }

  async timeline(taskId: TaskId, limit: number, cursor?: string): Promise<TimelinePage> {
    return this.unitOfWork.execute(async (stores) => {
      if ((await stores.tasks.getById(taskId)) === null) throw new NotFoundError("Task", taskId);
      return stores.timeline.list(taskId, limit, cursor);
    });
  }
}
