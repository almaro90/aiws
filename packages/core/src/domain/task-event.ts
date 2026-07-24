import type {
  AttachmentId,
  RunId,
  TaskCycleId,
  TaskEventId,
  TaskId,
  TaskMessageId,
  SpecRevisionId,
  DeliveryId,
} from "./ids.ts";
import type { QuestionId } from "./ids.ts";
import type { QuestionType } from "./question.ts";
import type { TaskStatus } from "./task.ts";

export const ACTOR_TYPES = ["web", "cli", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export type TaskEventType =
  | "task_created"
  | "task_updated"
  | "spec_updated"
  | "status_changed"
  | "question_created"
  | "question_updated"
  | "question_answered"
  | "question_dismissed"
  | "question_reopened"
  | "attachment_added"
  | "attachment_removed"
  | "pr_url_updated"
  | "task_archived"
  | "task_unarchived"
  | "run_started"
  | "run_succeeded"
  | "run_failed"
  | "run_cancelled"
  | "cycle_created"
  | "message_created"
  | "spec_revision_created"
  | "delivery_created"
  | "delivery_updated";

export interface TaskEvent {
  readonly id: TaskEventId;
  readonly taskId: TaskId;
  readonly type: TaskEventType;
  readonly actorType: ActorType;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export type TaskEventFact =
  | { readonly type: "task_created" }
  | { readonly type: "task_updated"; readonly fields: readonly string[] }
  | { readonly type: "spec_updated"; readonly spec: string }
  | {
      readonly type: "status_changed";
      readonly from: TaskStatus;
      readonly to: TaskStatus;
      readonly automatic: boolean;
      readonly reason?: string | null;
    }
  | { readonly type: "pr_url_updated"; readonly present: boolean }
  | {
      readonly type: "question_created" | "question_updated";
      readonly questionId: QuestionId;
      readonly questionType: QuestionType;
      readonly optionCount: number;
      readonly allowOther: boolean;
    }
  | { readonly type: "question_answered"; readonly questionId: QuestionId }
  | {
      readonly type: "attachment_added" | "attachment_removed";
      readonly attachmentId: AttachmentId;
      readonly originalName: string;
      readonly mimeType: string;
      readonly sizeBytes: number;
    }
  | {
      readonly type: "question_dismissed" | "question_reopened";
      readonly questionId: QuestionId;
      readonly reason?: string | null;
    }
  | { readonly type: "task_archived"; readonly reason?: string | null }
  | { readonly type: "task_unarchived" }
  | {
      readonly type: "run_started" | "run_succeeded" | "run_failed" | "run_cancelled";
      readonly runId: RunId;
      readonly reason?: string | null;
    }
  | { readonly type: "cycle_created"; readonly cycleId: TaskCycleId; readonly number: number }
  | {
      readonly type: "message_created";
      readonly messageId: TaskMessageId;
      readonly cycleId: TaskCycleId;
      readonly messageType: string;
      readonly attachmentCount: number;
    }
  | {
      readonly type: "spec_revision_created";
      readonly specRevisionId: SpecRevisionId;
      readonly cycleId: TaskCycleId;
      readonly revision: number;
    }
  | { readonly type: "delivery_created" | "delivery_updated"; readonly deliveryId: DeliveryId };

export interface TaskEventContext {
  readonly id: TaskEventId;
  readonly taskId: TaskId;
  readonly taskVersion: number;
  readonly actorType: ActorType;
  readonly createdAt: string;
}

export async function createTaskEvent(
  fact: TaskEventFact,
  context: TaskEventContext,
): Promise<TaskEvent> {
  return {
    id: context.id,
    taskId: context.taskId,
    type: fact.type,
    actorType: context.actorType,
    metadata: await metadataFor(fact, context.taskVersion),
    createdAt: context.createdAt,
  };
}

async function metadataFor(
  fact: TaskEventFact,
  taskVersion: number,
): Promise<Readonly<Record<string, unknown>>> {
  switch (fact.type) {
    case "task_created":
    case "task_unarchived":
      return { taskVersion };
    case "task_updated":
      return { taskVersion, fields: [...fact.fields] };
    case "spec_updated":
      return {
        taskVersion,
        length: new TextEncoder().encode(fact.spec).byteLength,
        sha256: await sha256(fact.spec),
      };
    case "status_changed":
      return {
        taskVersion,
        from: fact.from,
        to: fact.to,
        automatic: fact.automatic,
        ...(fact.reason == null ? {} : { reason: fact.reason }),
      };
    case "pr_url_updated":
      return { taskVersion, present: fact.present };
    case "question_created":
    case "question_updated":
      return {
        taskVersion,
        questionId: fact.questionId,
        questionType: fact.questionType,
        optionCount: fact.optionCount,
        allowOther: fact.allowOther,
      };
    case "question_answered":
      return { taskVersion, questionId: fact.questionId };
    case "attachment_added":
    case "attachment_removed":
      return {
        taskVersion,
        attachmentId: fact.attachmentId,
        originalName: fact.originalName,
        mimeType: fact.mimeType,
        sizeBytes: fact.sizeBytes,
      };
    case "question_dismissed":
    case "question_reopened":
      return {
        taskVersion,
        questionId: fact.questionId,
        ...(fact.reason == null ? {} : { reason: fact.reason }),
      };
    case "task_archived":
      return {
        taskVersion,
        ...(fact.reason == null ? {} : { reason: fact.reason }),
      };
    case "run_started":
    case "run_succeeded":
    case "run_failed":
    case "run_cancelled":
      return {
        taskVersion,
        runId: fact.runId,
        ...(fact.reason == null ? {} : { reason: fact.reason }),
      };
    case "cycle_created":
      return { taskVersion, cycleId: fact.cycleId, number: fact.number };
    case "message_created":
      return {
        taskVersion,
        messageId: fact.messageId,
        cycleId: fact.cycleId,
        messageType: fact.messageType,
        attachmentCount: fact.attachmentCount,
      };
    case "spec_revision_created":
      return {
        taskVersion,
        specRevisionId: fact.specRevisionId,
        cycleId: fact.cycleId,
        revision: fact.revision,
      };
    case "delivery_created":
    case "delivery_updated":
      return { taskVersion, deliveryId: fact.deliveryId };
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
