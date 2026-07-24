import type { ProjectId, TaskId } from "../domain/ids.ts";
import type { Delivery, TaskCycle, TaskMessage } from "../domain/cycle.ts";
import { assertProjectActive, isValidGitBranchName } from "../domain/project.ts";
import type { ActorType, TaskEvent, TaskEventFact } from "../domain/task-event.ts";
import {
  archiveTask,
  createTask,
  type Task,
  type TaskChanges,
  type TaskStatus,
  resumeTaskAutomation,
  transitionTask,
  unarchiveTask,
  updateTask,
} from "../domain/task.ts";
import {
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
  VersionConflictError,
} from "../errors/domain-errors.ts";
import type {
  Page,
  Stores,
  TaskAggregate,
  TaskEventListQuery,
  TaskListQuery,
  TaskSummary,
} from "../ports/stores.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import {
  assertExpectedVersion,
  type CoreDependencies,
  eventFor,
  timestamp,
  validateReason,
} from "./context.ts";

export interface CreateTaskInput {
  readonly projectId: ProjectId;
  readonly title?: string | null;
  readonly userRequest: string;
  readonly baseBranch?: string;
  readonly actorType: ActorType;
}

export interface UpdateTaskInput {
  readonly taskId: TaskId;
  readonly expectedVersion: number;
  readonly changes: TaskChanges;
  readonly actorType: ActorType;
}

export interface TransitionTaskInput {
  readonly taskId: TaskId;
  readonly expectedVersion: number;
  readonly from: TaskStatus;
  readonly to: TaskStatus;
  readonly reason?: string | null;
  readonly actorType: ActorType;
}

export interface ArchiveTaskInput {
  readonly taskId: TaskId;
  readonly expectedVersion: number;
  readonly reason?: string | null;
  readonly actorType: ActorType;
}

export interface UnarchiveTaskInput {
  readonly taskId: TaskId;
  readonly expectedVersion: number;
  readonly actorType: ActorType;
}

export interface ResumeTaskAutomationInput {
  readonly taskId: TaskId;
  readonly expectedVersion: number;
  readonly actorType: ActorType;
}

export class TaskUseCases {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly dependencies: CoreDependencies,
  ) {}

  async create(input: CreateTaskInput): Promise<TaskAggregate> {
    const now = timestamp(this.dependencies.clock);
    const cycleId = this.dependencies.ids.cycleId();
    return this.unitOfWork.execute(async (stores) => {
      const project = await stores.projects.getById(input.projectId);
      if (project === null) throw new NotFoundError("Project", input.projectId);
      assertProjectActive(project);
      if (project.repositoryMode === "local" && input.baseBranch !== undefined) {
        throw new ValidationError([
          { path: "baseBranch", message: "Local Projects do not use a Base Branch." },
        ]);
      }
      const baseBranch =
        project.repositoryMode === "managed" ? (input.baseBranch ?? project.defaultBranch) : null;
      if (
        project.repositoryMode === "managed" &&
        (baseBranch === null || !isValidGitBranchName(baseBranch))
      ) {
        throw new ValidationError([
          {
            path: "baseBranch",
            message: "Managed Tasks require a Base Branch between 1 and 255 characters.",
          },
        ]);
      }
      const deliveryId =
        project.repositoryMode === "managed" ? this.dependencies.ids.deliveryId() : null;
      const task = createTask({
        id: this.dependencies.ids.taskId(),
        projectId: input.projectId,
        ...(input.title === undefined ? {} : { title: input.title }),
        userRequest: input.userRequest,
        now,
        currentCycleId: cycleId,
      });
      const createdTask = deliveryId === null ? task : { ...task, currentDeliveryId: deliveryId };
      const cycle: TaskCycle = {
        id: cycleId,
        taskId: task.id,
        number: 1,
        deliveryId,
        createdAt: now,
        completedAt: null,
      };
      const message: TaskMessage = {
        id: this.dependencies.ids.messageId(),
        taskId: task.id,
        cycleId,
        type: "initial_request",
        text: task.userRequest,
        createdAt: now,
      };
      const event = await eventFor(
        createdTask,
        input.actorType,
        { type: "task_created" },
        this.dependencies,
        now,
      );
      await stores.tasks.insert(createdTask);
      await stores.cycles.insert(cycle);
      await stores.messages.insert(message);
      if (deliveryId !== null) {
        const delivery: Delivery = {
          id: deliveryId,
          taskId: task.id,
          branchName: `aiws/${task.id}/${deliveryId}`,
          baseBranch,
          prUrl: null,
          createdAt: now,
          updatedAt: now,
        };
        await stores.deliveries.insert(delivery);
      }
      await stores.events.append([event]);
      return this.aggregate(stores, createdTask);
    });
  }

  async get(id: TaskId): Promise<TaskAggregate> {
    return this.unitOfWork.execute(async (stores) =>
      this.aggregate(stores, await this.loadTask(stores, id)),
    );
  }

  async list(query: TaskListQuery): Promise<Page<TaskSummary>> {
    return this.unitOfWork.execute((stores) => stores.tasks.list(query));
  }

  async activity(query: TaskEventListQuery): Promise<Page<TaskEvent>> {
    return this.unitOfWork.execute(async (stores) => {
      await this.loadTask(stores, query.taskId);
      return stores.events.list(query);
    });
  }

  async update(input: UpdateTaskInput): Promise<TaskAggregate> {
    return this.unitOfWork.execute(async (stores) => {
      const current = await this.loadTask(stores, input.taskId);
      assertExpectedVersion(current, input.expectedVersion);
      const now = timestamp(this.dependencies.clock);
      let mutation = updateTask(current, input.changes, now);
      const facts: TaskEventFact[] = [];
      const ordinaryFields = mutation.changedFields.filter(
        (field) => field !== "curatorSpec" && field !== "prUrl",
      );
      if (ordinaryFields.length > 0) {
        facts.push({ type: "task_updated", fields: ordinaryFields });
      }
      if (mutation.changedFields.includes("curatorSpec")) {
        facts.push({ type: "spec_updated", spec: mutation.task.curatorSpec });
        const specRevisionId = this.dependencies.ids.specRevisionId();
        const revision = await stores.specRevisions.nextRevision(
          current.id,
          current.currentCycleId,
        );
        await stores.specRevisions.insert({
          id: specRevisionId,
          taskId: current.id,
          cycleId: current.currentCycleId,
          revision,
          content: mutation.task.curatorSpec,
          createdAt: now,
        });
        facts.push({
          type: "spec_revision_created",
          specRevisionId,
          cycleId: current.currentCycleId,
          revision,
        });
      }
      if (mutation.changedFields.includes("prUrl")) {
        let deliveryId = current.currentDeliveryId;
        if (deliveryId === null && mutation.task.prUrl !== null) {
          deliveryId = this.dependencies.ids.deliveryId();
          await stores.deliveries.insert({
            id: deliveryId,
            taskId: current.id,
            branchName: null,
            baseBranch: null,
            prUrl: mutation.task.prUrl,
            createdAt: now,
            updatedAt: now,
          });
          facts.push({ type: "delivery_created", deliveryId });
          mutation = { ...mutation, task: { ...mutation.task, currentDeliveryId: deliveryId } };
          const cycle = await stores.cycles.getById(current.currentCycleId);
          if (cycle !== null) await stores.cycles.update({ ...cycle, deliveryId });
        } else if (deliveryId !== null) {
          const delivery = await stores.deliveries.getById(deliveryId);
          if (delivery !== null)
            await stores.deliveries.update({
              ...delivery,
              prUrl: mutation.task.prUrl,
              updatedAt: now,
            });
          facts.push({ type: "delivery_updated", deliveryId });
        }
        facts.push({ type: "pr_url_updated", present: mutation.task.prUrl !== null });
      }
      const events = await this.eventsFor(mutation.task, input.actorType, facts, now);
      await this.persistMutation(stores, mutation.task, input.expectedVersion, events);
      return this.aggregate(stores, mutation.task);
    });
  }

  async transition(input: TransitionTaskInput): Promise<TaskAggregate> {
    validateReason(input.reason);
    return this.unitOfWork.execute(async (stores) => {
      const current = await this.loadTask(stores, input.taskId);
      assertExpectedVersion(current, input.expectedVersion);
      const now = timestamp(this.dependencies.clock);
      const openQuestions = await stores.questions.countOpenByTaskId(
        input.taskId,
        current.currentCycleId,
      );
      if (input.to === "curating") {
        const project = await stores.projects.getById(current.projectId);
        if (project === null) throw new NotFoundError("Project", current.projectId);
        if (project.repositoryMode === "managed") {
          if (project.curationAgentProfileId === null) {
            throw new InvalidTransitionError(
              "Managed Project requires a Curation Agent Profile before curation.",
              { projectId: project.id, field: "curationAgentProfileId" },
            );
          }
          const profile = await stores.agentProfiles.getById(project.curationAgentProfileId);
          if (profile === null || !profile.enabled) {
            throw new InvalidTransitionError(
              "Managed Project requires an enabled Curation Agent Profile before curation.",
              {
                projectId: project.id,
                field: "curationAgentProfileId",
                curationAgentProfileId: project.curationAgentProfileId,
              },
            );
          }
        }
      }
      const task = transitionTask(current, input.from, input.to, openQuestions, now);
      const event = await eventFor(
        task,
        input.actorType,
        {
          type: "status_changed",
          from: input.from,
          to: input.to,
          automatic: false,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
        this.dependencies,
        now,
      );
      await this.persistMutation(stores, task, input.expectedVersion, [event]);
      if (input.to === "done") {
        const cycle = await stores.cycles.getById(task.currentCycleId);
        if (cycle !== null) await stores.cycles.update({ ...cycle, completedAt: now });
      }
      return this.aggregate(stores, task);
    });
  }

  async archive(input: ArchiveTaskInput): Promise<TaskAggregate> {
    validateReason(input.reason);
    return this.unitOfWork.execute(async (stores) => {
      const current = await this.loadTask(stores, input.taskId);
      assertExpectedVersion(current, input.expectedVersion);
      const now = timestamp(this.dependencies.clock);
      const task = archiveTask(current, now);
      const event = await eventFor(
        task,
        input.actorType,
        {
          type: "task_archived",
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
        this.dependencies,
        now,
      );
      await this.persistMutation(stores, task, input.expectedVersion, [event]);
      return this.aggregate(stores, task);
    });
  }

  async unarchive(input: UnarchiveTaskInput): Promise<TaskAggregate> {
    return this.unitOfWork.execute(async (stores) => {
      const current = await this.loadTask(stores, input.taskId);
      assertExpectedVersion(current, input.expectedVersion);
      const now = timestamp(this.dependencies.clock);
      const task = unarchiveTask(current, now);
      const event = await eventFor(
        task,
        input.actorType,
        { type: "task_unarchived" },
        this.dependencies,
        now,
      );
      await this.persistMutation(stores, task, input.expectedVersion, [event]);
      return this.aggregate(stores, task);
    });
  }

  async resumeAutomation(input: ResumeTaskAutomationInput): Promise<TaskAggregate> {
    return this.unitOfWork.execute(async (stores) => {
      const current = await this.loadTask(stores, input.taskId);
      assertExpectedVersion(current, input.expectedVersion);
      const activeRun = (await stores.runs.listByTaskId(current.id)).find((run) =>
        ["queued", "preparing", "running", "publishing"].includes(run.status),
      );
      if (activeRun !== undefined) {
        throw new InvalidTransitionError("Task already has an active Run.", {
          runId: activeRun.id,
        });
      }
      const now = timestamp(this.dependencies.clock);
      const task = resumeTaskAutomation(current, now);
      const event = await eventFor(
        task,
        input.actorType,
        { type: "task_updated", fields: ["automationPaused"] },
        this.dependencies,
        now,
      );
      await this.persistMutation(stores, task, input.expectedVersion, [event]);
      return this.aggregate(stores, task);
    });
  }

  private async loadTask(stores: Stores, id: TaskId): Promise<Task> {
    const task = await stores.tasks.getById(id);
    if (task === null) throw new NotFoundError("Task", id);
    return task;
  }

  private async aggregate(stores: Stores, task: Task): Promise<TaskAggregate> {
    const [project, questions, attachments, currentCycle, currentDelivery] = await Promise.all([
      stores.projects.getById(task.projectId),
      stores.questions.listByTaskId(task.id),
      stores.attachments.listByTaskId(task.id),
      stores.cycles.getById(task.currentCycleId),
      task.currentDeliveryId === null
        ? Promise.resolve(null)
        : stores.deliveries.getById(task.currentDeliveryId),
    ]);
    if (project === null) throw new NotFoundError("Project", task.projectId);
    if (currentCycle === null) throw new NotFoundError("Task", task.id);
    return {
      ...task,
      project,
      questions,
      attachments: attachments.map(({ storageKey: _storageKey, ...attachment }) => attachment),
      currentCycle,
      currentDelivery,
    };
  }

  private async persistMutation(
    stores: Stores,
    task: Task,
    expectedVersion: number,
    events: readonly TaskEvent[],
  ): Promise<void> {
    if (!(await stores.tasks.updateIfVersion(task, expectedVersion))) {
      throw new VersionConflictError(expectedVersion);
    }
    await stores.events.append(events);
  }

  private async eventsFor(
    task: Task,
    actorType: ActorType,
    facts: readonly TaskEventFact[],
    createdAt: string,
  ): Promise<TaskEvent[]> {
    return Promise.all(
      facts.map((fact) => eventFor(task, actorType, fact, this.dependencies, createdAt)),
    );
  }
}
