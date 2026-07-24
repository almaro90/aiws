import type { TaskEvent, TaskEventFact, ActorType } from "../domain/task-event.ts";
import { createTaskEvent } from "../domain/task-event.ts";
import type { Task } from "../domain/task.ts";
import { ValidationError, VersionConflictError } from "../errors/domain-errors.ts";
import type { Clock } from "../ports/clock.ts";
import type { IdGenerator } from "../ports/id-generator.ts";

export interface CoreDependencies {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export function timestamp(clock: Clock): string {
  return clock.now().toISOString();
}

export function assertExpectedVersion(task: Task, expectedVersion: number): void {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new ValidationError([
      { path: "expectedVersion", message: "Must be a positive integer." },
    ]);
  }
  if (task.version !== expectedVersion) {
    throw new VersionConflictError(expectedVersion, task.version);
  }
}

export function validateReason(reason: string | null | undefined): void {
  if (reason !== undefined && reason !== null && Array.from(reason).length > 2_000) {
    throw new ValidationError([
      { path: "reason", message: "Must contain at most 2000 characters." },
    ]);
  }
}

export async function eventFor(
  task: Task,
  actorType: ActorType,
  fact: TaskEventFact,
  dependencies: CoreDependencies,
  createdAt: string,
): Promise<TaskEvent> {
  return createTaskEvent(fact, {
    id: dependencies.ids.eventId(),
    taskId: task.id,
    taskVersion: task.version,
    actorType,
    createdAt,
  });
}
