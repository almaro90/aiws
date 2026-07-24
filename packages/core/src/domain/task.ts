import { InvalidTransitionError, type ValidationIssue } from "../errors/domain-errors.ts";
import type { DeliveryId, ProjectId, TaskCycleId, TaskId } from "./ids.ts";
import { assertNonBlank, characterLength, throwIfIssues } from "./validation.ts";

export const TASK_STATUSES = [
  "draft",
  "curating",
  "blocked",
  "ready",
  "implementing",
  "done",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  readonly id: TaskId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly userRequest: string;
  readonly curatorSpec: string;
  readonly status: TaskStatus;
  readonly prUrl: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly automationPaused: boolean;
  readonly currentCycleId: TaskCycleId;
  readonly currentDeliveryId: DeliveryId | null;
}

export interface NewTask {
  readonly id: TaskId;
  readonly projectId: ProjectId;
  readonly title?: string | null;
  readonly userRequest: string;
  readonly now: string;
  readonly currentCycleId?: TaskCycleId;
}

export type TaskChanges = Partial<Pick<Task, "title" | "userRequest" | "curatorSpec" | "prUrl">>;

export interface TaskMutation {
  readonly task: Task;
  readonly changedFields: readonly (keyof TaskChanges)[];
}

export function createTask(input: NewTask): Task {
  const issues: ValidationIssue[] = [];
  assertNonBlank(input.userRequest, "userRequest", 100_000, issues);
  const title = input.title == null ? generateTaskTitle(input.userRequest) : input.title;
  assertNonBlank(title, "title", 200, issues);
  throwIfIssues(issues);

  return {
    id: input.id,
    projectId: input.projectId,
    title,
    userRequest: input.userRequest,
    curatorSpec: "",
    status: "draft",
    prUrl: null,
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
    archivedAt: null,
    automationPaused: false,
    currentCycleId: input.currentCycleId ?? (`cyc_${input.id.slice(4)}` as TaskCycleId),
    currentDeliveryId: null,
  };
}

export function generateTaskTitle(userRequest: string): string {
  const firstNonEmptyLine =
    userRequest.split(/\r?\n/u).find((line) => line.trim().length > 0) ?? "";
  const normalized = firstNonEmptyLine.trim().replace(/\s+/gu, " ");
  return Array.from(normalized).slice(0, 120).join("");
}

export function updateTask(task: Task, changes: TaskChanges, now: string): TaskMutation {
  assertTaskActive(task);
  const keys = Object.keys(changes);
  const allowedFields = ["title", "userRequest", "curatorSpec", "prUrl"] as const;
  const unknownField = keys.find((field) => !(allowedFields as readonly string[]).includes(field));
  if (unknownField !== undefined) {
    throwIfIssues([{ path: unknownField, message: "Field cannot be changed." }]);
  }
  const fields = keys as (keyof TaskChanges)[];
  if (fields.length === 0) {
    throwIfIssues([{ path: "changes", message: "At least one field is required." }]);
  }

  const issues: ValidationIssue[] = [];
  if (changes.title !== undefined) {
    assertNonBlank(changes.title, "title", 200, issues);
    if (task.status !== "draft" && task.status !== "curating") {
      issues.push({
        path: "title",
        message: "Can only be changed while Task is Draft or Curating.",
      });
    }
  }
  if (changes.userRequest !== undefined) {
    assertNonBlank(changes.userRequest, "userRequest", 100_000, issues);
    if (task.status !== "draft") {
      issues.push({ path: "userRequest", message: "Can only be changed while Task is Draft." });
    }
  }
  if (changes.curatorSpec !== undefined) {
    if (new TextEncoder().encode(changes.curatorSpec).byteLength > 1_048_576) {
      issues.push({ path: "curatorSpec", message: "Must contain at most 1048576 UTF-8 bytes." });
    }
    if (task.status !== "draft" && task.status !== "blocked" && changes.curatorSpec.trim() === "") {
      issues.push({
        path: "curatorSpec",
        message: `Cannot be empty while Task is ${task.status}.`,
      });
    }
  }
  if (changes.prUrl !== undefined && changes.prUrl !== null) validatePrUrl(changes.prUrl, issues);
  throwIfIssues(issues);

  const updated: Task = {
    ...task,
    ...(changes.title === undefined ? {} : { title: changes.title }),
    ...(changes.userRequest === undefined ? {} : { userRequest: changes.userRequest }),
    ...(changes.curatorSpec === undefined ? {} : { curatorSpec: changes.curatorSpec }),
    ...(changes.prUrl === undefined ? {} : { prUrl: changes.prUrl }),
    version: task.version + 1,
    updatedAt: now,
  };
  return {
    task: updated,
    changedFields: fields,
  };
}

export function transitionTask(
  task: Task,
  from: TaskStatus,
  to: TaskStatus,
  openQuestionCount: number,
  now: string,
): Task {
  assertTaskActive(task);
  if (task.status !== from) {
    throw new InvalidTransitionError("Task source status does not match.", {
      expectedFrom: from,
      currentStatus: task.status,
      to,
    });
  }

  const allowed =
    (from === "draft" && to === "curating") ||
    (from === "curating" && to === "ready") ||
    (from === "ready" && to === "implementing") ||
    (from === "implementing" && to === "done") ||
    false;
  if (!allowed) {
    throw new InvalidTransitionError("Task transition is not allowed.", { from, to });
  }
  if (to === "ready") {
    if (task.curatorSpec.trim() === "") {
      throw new InvalidTransitionError("Task requires a non-empty Curator Spec to become Ready.", {
        from,
        to,
      });
    }
    if (openQuestionCount > 0) {
      throw new InvalidTransitionError("Task with open Questions cannot become Ready.", {
        from,
        to,
        openQuestionCount,
      });
    }
  }
  return { ...task, status: to, version: task.version + 1, updatedAt: now };
}

export function archiveTask(task: Task, now: string): Task {
  assertTaskActive(task);
  return { ...task, archivedAt: now, version: task.version + 1, updatedAt: now };
}

export function unarchiveTask(task: Task, now: string): Task {
  if (task.archivedAt === null) {
    throw new InvalidTransitionError("Task is not archived.", { taskId: task.id });
  }
  return { ...task, archivedAt: null, version: task.version + 1, updatedAt: now };
}

export function assertTaskActive(task: Task): void {
  if (task.archivedAt !== null) {
    throw new InvalidTransitionError("Archived Task is read-only.", { taskId: task.id });
  }
}

export function mutateTaskForQuestion(
  task: Task,
  now: string,
  status: TaskStatus = task.status,
): Task {
  assertTaskActive(task);
  return { ...task, status, version: task.version + 1, updatedAt: now };
}

export function mutateTaskForAttachment(task: Task, now: string): Task {
  assertTaskActive(task);
  return { ...task, version: task.version + 1, updatedAt: now };
}

export function failAutomatedTask(task: Task, now: string): Task {
  assertTaskActive(task);
  if (task.status !== "implementing") {
    throw new InvalidTransitionError("Only an implementing Task can fail an automated Run.", {
      currentStatus: task.status,
    });
  }
  return {
    ...task,
    status: "ready",
    automationPaused: true,
    version: task.version + 1,
    updatedAt: now,
  };
}

export function failCurationTask(task: Task, now: string): Task {
  assertTaskActive(task);
  if (task.status !== "curating") {
    throw new InvalidTransitionError("Only a Curating Task can fail a curation Run.", {
      currentStatus: task.status,
    });
  }
  return { ...task, automationPaused: true, version: task.version + 1, updatedAt: now };
}

export function resumeTaskAutomation(task: Task, now: string): Task {
  assertTaskActive(task);
  if (task.status !== "curating" && task.status !== "ready") {
    throw new InvalidTransitionError(
      "Automation can only be resumed while a Task is Curating or Ready.",
      { currentStatus: task.status },
    );
  }
  if (!task.automationPaused) {
    throw new InvalidTransitionError("Task automation is not paused.", {
      currentStatus: task.status,
    });
  }
  return {
    ...task,
    automationPaused: false,
    version: task.version + 1,
    updatedAt: now,
  };
}

export function completeCurationTask(
  task: Task,
  outcome: "ready" | "blocked",
  changes: { readonly title?: string; readonly curatorSpec?: string },
  now: string,
): Task {
  assertTaskActive(task);
  if (task.status !== "curating") {
    throw new InvalidTransitionError("Only a Curating Task can complete a curation Run.", {
      currentStatus: task.status,
    });
  }
  const issues: ValidationIssue[] = [];
  if (changes.title !== undefined) assertNonBlank(changes.title, "title", 200, issues);
  const curatorSpec = changes.curatorSpec ?? task.curatorSpec;
  if (new TextEncoder().encode(curatorSpec).byteLength > 1_048_576) {
    issues.push({ path: "curatorSpec", message: "Must contain at most 1048576 UTF-8 bytes." });
  }
  if (outcome === "ready" && curatorSpec.trim() === "") {
    issues.push({ path: "curatorSpec", message: "A Ready curation requires a non-empty spec." });
  }
  throwIfIssues(issues);
  return {
    ...task,
    ...(changes.title === undefined ? {} : { title: changes.title }),
    curatorSpec,
    status: outcome,
    automationPaused: false,
    version: task.version + 1,
    updatedAt: now,
  };
}

export function completeAutomatedTask(task: Task, prUrl: string, now: string): Task {
  assertTaskActive(task);
  if (task.status !== "implementing") {
    throw new InvalidTransitionError("Only an implementing Task can complete an automated Run.", {
      currentStatus: task.status,
    });
  }
  const issues: ValidationIssue[] = [];
  validatePrUrl(prUrl, issues);
  throwIfIssues(issues);
  return {
    ...task,
    status: "done",
    prUrl,
    automationPaused: false,
    version: task.version + 1,
    updatedAt: now,
  };
}

function validatePrUrl(value: string, issues: ValidationIssue[]): void {
  if (characterLength(value) > 2_048) {
    issues.push({ path: "prUrl", message: "Must contain at most 2048 characters." });
    return;
  }
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin === "null") {
      issues.push({ path: "prUrl", message: "Must be an absolute HTTP or HTTPS URL." });
    }
  } catch {
    issues.push({ path: "prUrl", message: "Must be an absolute HTTP or HTTPS URL." });
  }
}
