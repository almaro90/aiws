import type {
  DeliveryId,
  QuestionAnswerId,
  QuestionId,
  QuestionOptionId,
  SpecRevisionId,
  TaskCycleId,
  TaskId,
  TaskMessageId,
} from "./ids.ts";
import type { Question } from "./question.ts";
import type { Run } from "./automation.ts";
import type { TaskEvent } from "./task-event.ts";

export interface TaskCycle {
  readonly id: TaskCycleId;
  readonly taskId: TaskId;
  readonly number: number;
  readonly deliveryId: DeliveryId | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export type TaskMessageType = "initial_request" | "change" | "context";
export interface TaskMessage {
  readonly id: TaskMessageId;
  readonly taskId: TaskId;
  readonly cycleId: TaskCycleId;
  readonly type: TaskMessageType;
  readonly text: string | null;
  readonly createdAt: string;
}

export interface SpecRevision {
  readonly id: SpecRevisionId;
  readonly taskId: TaskId;
  readonly cycleId: TaskCycleId;
  readonly revision: number;
  readonly content: string;
  readonly createdAt: string;
}

export interface QuestionAnswer {
  readonly id: QuestionAnswerId;
  readonly questionId: QuestionId;
  readonly cycleId: TaskCycleId;
  readonly revision: number;
  readonly answerText: string | null;
  readonly selectedOptionIds: readonly QuestionOptionId[];
  readonly createdAt: string;
}

export interface Delivery {
  readonly id: DeliveryId;
  readonly taskId: TaskId;
  readonly branchName: string | null;
  readonly baseBranch: string | null;
  readonly prUrl: string | null;
  readonly prState: "draft" | "open" | "closed" | "merged" | null;
  readonly checksState: "pending" | "passed" | "failed" | "unknown" | null;
  readonly checksPassed: number;
  readonly checksFailed: number;
  readonly checksPending: number;
  readonly externalUpdatedAt: string | null;
  readonly lastSynchronizedAt: string | null;
  readonly synchronizationError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type TimelineItem =
  | ({ readonly kind: "message" } & TaskMessage)
  | ({ readonly kind: "spec_revision" } & SpecRevision)
  | {
      readonly kind: "question";
      readonly cycleId: TaskCycleId;
      readonly createdAt: string;
      readonly question: Question;
      readonly answers: readonly QuestionAnswer[];
    }
  | {
      readonly kind: "run";
      readonly cycleId: TaskCycleId;
      readonly createdAt: string;
      readonly run: Run;
    }
  | {
      readonly kind: "event";
      readonly cycleId: TaskCycleId | null;
      readonly createdAt: string;
      readonly event: TaskEvent;
    };

export interface TimelinePage {
  readonly items: readonly TimelineItem[];
  readonly nextCursor: string | null;
}
