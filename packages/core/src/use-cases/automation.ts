import {
  createAgentProfile,
  createConnection,
  createRun,
  heartbeatRun,
  transitionRun,
  type AgentAuthMode,
  type AgentProfile,
  type AgentModelCatalog,
  type Connection,
  type Run,
  type RunStatus,
  type RunKind,
  type RunRetryMode,
} from "../domain/automation.ts";
import type { AgentProfileId, ConnectionId, RunId, TaskId } from "../domain/ids.ts";
import {
  completeCurationTask,
  completeAutomatedTask,
  failCurationTask,
  failAutomatedTask,
  transitionTask,
  type Task,
} from "../domain/task.ts";
import { createQuestion, type Question, type QuestionType } from "../domain/question.ts";
import type { Attachment } from "../domain/attachment.ts";
import type { Delivery, SpecRevision, TaskCycle, TaskMessage } from "../domain/cycle.ts";
import { createTaskEvent, type TaskEventFact } from "../domain/task-event.ts";
import { NotFoundError, ValidationError, VersionConflictError } from "../errors/domain-errors.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { timestamp, type CoreDependencies } from "./context.ts";

export class ConnectionUseCases {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly dependencies: CoreDependencies,
  ) {}

  list(): Promise<readonly Connection[]> {
    return this.unitOfWork.execute((stores) => stores.connections.list());
  }

  get(id: ConnectionId): Promise<Connection> {
    return this.unitOfWork.execute(async (stores) => {
      const connection = await stores.connections.getById(id);
      if (connection === null) throw new NotFoundError("Connection", id);
      return connection;
    });
  }

  register(input: {
    readonly host: string;
    readonly externalAccountId: string;
    readonly displayName: string;
    readonly installationId: string;
  }): Promise<Connection> {
    return this.unitOfWork.execute(async (stores) => {
      const existing = await stores.connections.findByInstallation(
        "github",
        input.host,
        input.installationId,
      );
      if (existing !== null) return existing;
      const connection = createConnection({
        id: this.dependencies.ids.connectionId(),
        provider: "github",
        ...input,
        now: timestamp(this.dependencies.clock),
      });
      await stores.connections.insert(connection);
      return connection;
    });
  }

  revoke(id: ConnectionId): Promise<Connection> {
    return this.unitOfWork.execute(async (stores) => {
      const current = await stores.connections.getById(id);
      if (current === null) throw new NotFoundError("Connection", id);
      const connection = {
        ...current,
        status: "revoked" as const,
        updatedAt: timestamp(this.dependencies.clock),
      };
      await stores.connections.update(connection);
      return connection;
    });
  }
}

export class AgentProfileUseCases {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly dependencies: CoreDependencies,
  ) {}

  list(): Promise<readonly AgentProfile[]> {
    return this.unitOfWork.execute((stores) => stores.agentProfiles.list());
  }

  get(id: AgentProfileId): Promise<AgentProfile> {
    return this.unitOfWork.execute(async (stores) => {
      const profile = await stores.agentProfiles.getById(id);
      if (profile === null) throw new NotFoundError("AgentProfile", id);
      return profile;
    });
  }

  create(input: {
    readonly name: string;
    readonly authMode: AgentAuthMode;
    readonly credentialReference: string;
    readonly model: string;
    readonly reasoningEffort: string;
    readonly catalog: AgentModelCatalog;
  }): Promise<AgentProfile> {
    return this.unitOfWork.execute(async (stores) => {
      if (await stores.agentProfiles.nameExists(input.name)) {
        throw new ValidationError([
          { path: "name", message: "Agent Profile name is already registered." },
        ]);
      }
      const selectedModel = input.catalog.models.find((model) => model.id === input.model);
      if (selectedModel === undefined) {
        throw new ValidationError([{ path: "model", message: "Model is not in the catalog." }]);
      }
      if (!selectedModel.supportedReasoningEfforts.includes(input.reasoningEffort)) {
        throw new ValidationError([
          {
            path: "reasoningEffort",
            message: "Reasoning effort is not supported by the selected model.",
          },
        ]);
      }
      const profile = createAgentProfile({
        id: this.dependencies.ids.agentProfileId(),
        name: input.name,
        runtime: "codex",
        authMode: input.authMode,
        credentialReference: input.credentialReference,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        now: timestamp(this.dependencies.clock),
      });
      await stores.agentProfiles.insert(profile);
      return profile;
    });
  }

  setEnabled(id: AgentProfileId, enabled: boolean): Promise<AgentProfile> {
    return this.unitOfWork.execute(async (stores) => {
      const current = await stores.agentProfiles.getById(id);
      if (current === null) throw new NotFoundError("AgentProfile", id);
      const profile = { ...current, enabled, updatedAt: timestamp(this.dependencies.clock) };
      await stores.agentProfiles.update(profile);
      return profile;
    });
  }
}

export interface RunAssignment {
  readonly run: Run;
  readonly task: Task & {
    readonly questions: readonly Question[];
    readonly attachments: readonly Attachment[];
    readonly cycles: readonly TaskCycle[];
    readonly messages: readonly TaskMessage[];
    readonly specRevisions: readonly SpecRevision[];
  };
  readonly project: import("../domain/project.ts").Project;
  readonly agentProfile: AgentProfile;
  readonly delivery: Delivery | null;
}

export class RunUseCases {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly dependencies: CoreDependencies,
  ) {}

  get(id: RunId): Promise<Run> {
    return this.unitOfWork.execute(async (stores) => {
      const run = await stores.runs.getById(id);
      if (run === null) throw new NotFoundError("Run", id);
      return run;
    });
  }

  listForTask(taskId: TaskId, kind?: RunKind): Promise<readonly Run[]> {
    return this.unitOfWork.execute((stores) => stores.runs.listByTaskId(taskId, kind));
  }

  claimNext(): Promise<RunAssignment | null> {
    return this.unitOfWork.execute(async (stores) => {
      const now = timestamp(this.dependencies.clock);
      const queued = await stores.runs.getNextQueued();
      if (queued !== null) {
        const task = await requiredTask(stores.tasks, queued.taskId);
        const project = await requiredProject(stores.projects, queued.projectId);
        const profile = await stores.agentProfiles.getById(queued.agentProfileId);
        if (profile === null || !profile.enabled)
          throw new ValidationError([
            { path: "agentProfileId", message: "Agent Profile is unavailable." },
          ]);
        const run = transitionRun(queued, "preparing", now);
        await stores.runs.update(run);
        return this.assignment(stores, run, task, project, profile);
      }
      const curation = await this.claimCandidate(stores, "curation", now);
      if (curation !== null) return curation;
      return this.claimCandidate(stores, "implementation", now);
    });
  }

  private async claimCandidate(
    stores: import("../ports/stores.ts").Stores,
    kind: RunKind,
    now: string,
  ): Promise<RunAssignment | null> {
    const candidates =
      kind === "curation"
        ? await stores.tasks.listCurationCandidates(100)
        : await stores.tasks.listAutomationCandidates(100);
    for (const task of candidates) {
      const project = await stores.projects.getById(task.projectId);
      if (
        project === null ||
        project.archivedAt !== null ||
        project.repositoryMode !== "managed" ||
        (kind === "implementation" && !project.automationEnabled) ||
        (kind === "curation"
          ? project.curationAgentProfileId
          : project.implementationAgentProfileId) === null
      )
        continue;
      if (
        kind === "implementation" &&
        !scheduleMatches(
          project.scheduleCron,
          project.scheduleTimezone,
          this.dependencies.clock.now(),
        )
      )
        continue;
      if ((await stores.runs.countActiveByProject(project.id)) >= project.maxConcurrency) continue;
      const profileId =
        kind === "curation" ? project.curationAgentProfileId : project.implementationAgentProfileId;
      if (profileId === null) continue;
      const profile = await stores.agentProfiles.getById(profileId);
      if (profile === null || !profile.enabled) continue;
      const runId = this.dependencies.ids.runId();
      let deliveryId = task.currentDeliveryId;
      const deliveryCreated = deliveryId === null;
      if (deliveryId === null) {
        deliveryId = this.dependencies.ids.deliveryId();
        await stores.deliveries.insert({
          id: deliveryId,
          taskId: task.id,
          branchName: `aiws/${task.id}/${deliveryId}`,
          baseBranch: project.defaultBranch,
          prUrl: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      const claimed =
        kind === "implementation"
          ? {
              ...transitionTask(task, "ready", "implementing", 0, now),
              automationPaused: false,
              currentDeliveryId: deliveryId,
            }
          : deliveryCreated
            ? { ...task, currentDeliveryId: deliveryId, version: task.version + 1, updatedAt: now }
            : task;
      const queuedRun = createRun({
        id: runId,
        taskId: task.id,
        cycleId: task.currentCycleId,
        deliveryId,
        projectId: project.id,
        agentProfileId: profile.id,
        kind,
        attempt: await stores.runs.nextAttempt(task.id, kind),
        taskVersion: claimed.version,
        branchName: kind === "implementation" ? `aiws/${task.id}/${deliveryId}` : null,
        executionStage: "agent",
        resumeFromRunId: null,
        now,
      });
      const run = transitionRun(queuedRun, "preparing", now);
      if (
        claimed.version !== task.version &&
        !(await stores.tasks.updateIfVersion(claimed, task.version))
      )
        continue;
      if (deliveryCreated) {
        const cycle = await stores.cycles.getById(task.currentCycleId);
        if (cycle !== null) await stores.cycles.update({ ...cycle, deliveryId });
      }
      await stores.runs.insert(run);
      const facts: TaskEventFact[] = [{ type: "run_started", runId }];
      if (deliveryCreated) facts.unshift({ type: "delivery_created", deliveryId });
      if (kind === "implementation")
        facts.unshift({
          type: "status_changed",
          from: "ready",
          to: "implementing",
          automatic: true,
          reason: "Automated implementation Run claimed the Task.",
        });
      await appendFacts(stores.events, this.dependencies, claimed, now, facts);
      return this.assignment(stores, run, claimed, project, profile);
    }
    return null;
  }

  retry(
    runId: RunId,
    expectedVersion: number,
    mode: RunRetryMode = "auto",
  ): Promise<RunAssignment> {
    return this.unitOfWork.execute(async (stores) => {
      const previous = await requiredRun(stores.runs, runId);
      if (previous.status !== "failed" && previous.status !== "cancelled") {
        throw new ValidationError([
          { path: "runId", message: "Only a failed or cancelled Run can be retried." },
        ]);
      }
      const task = await requiredTask(stores.tasks, previous.taskId);
      assertVersion(task, expectedVersion);
      const project = await requiredProject(stores.projects, task.projectId);
      if ((await stores.runs.countActiveByProject(project.id)) >= project.maxConcurrency) {
        throw new ValidationError([
          { path: "maxConcurrency", message: "Project concurrency limit is already reached." },
        ]);
      }
      const profileField =
        previous.kind === "curation" ? "curationAgentProfileId" : "implementationAgentProfileId";
      const profileId = project[profileField];
      if (profileId === null)
        throw new ValidationError([
          { path: profileField, message: `Project has no ${previous.kind} Agent Profile.` },
        ]);
      const profile = await stores.agentProfiles.getById(profileId);
      if (profile === null || !profile.enabled)
        throw new ValidationError([
          { path: profileField, message: "Agent Profile is unavailable." },
        ]);
      const now = timestamp(this.dependencies.clock);
      const nextId = this.dependencies.ids.runId();
      const hasPublishingCheckpoint =
        previous.kind === "implementation" &&
        previous.executionStage === "publishing" &&
        previous.baseSha !== null;
      if (mode === "publish_only" && !hasPublishingCheckpoint) {
        throw new ValidationError([
          {
            path: "mode",
            message: "publish_only requires a completed agent checkpoint with a recorded base SHA.",
          },
        ]);
      }
      const publishOnly = mode === "publish_only" || (mode === "auto" && hasPublishingCheckpoint);
      const claimed =
        previous.kind === "implementation"
          ? {
              ...transitionTask(task, "ready", "implementing", 0, now),
              automationPaused: false,
            }
          : {
              ...task,
              automationPaused: false,
              version: task.version + 1,
              updatedAt: now,
            };
      const run = createRun({
        id: nextId,
        taskId: task.id,
        cycleId: task.currentCycleId,
        deliveryId: task.currentDeliveryId,
        projectId: project.id,
        agentProfileId: profile.id,
        kind: previous.kind,
        attempt: await stores.runs.nextAttempt(task.id, previous.kind),
        taskVersion: claimed.version,
        branchName: previous.kind === "implementation" ? previous.branchName : null,
        executionStage: publishOnly ? "publishing" : "agent",
        resumeFromRunId: publishOnly ? previous.id : null,
        now,
      });
      const checkpointedRun = publishOnly
        ? {
            ...run,
            baseSha: previous.baseSha,
            headSha: previous.headSha,
            summary: previous.summary,
          }
        : run;
      if (!(await stores.tasks.updateIfVersion(claimed, expectedVersion)))
        throw new VersionConflictError(expectedVersion);
      await stores.runs.insert(checkpointedRun);
      const facts: TaskEventFact[] = [{ type: "run_started", runId: nextId }];
      if (previous.kind === "implementation")
        facts.unshift({
          type: "status_changed",
          from: "ready",
          to: "implementing",
          automatic: false,
          reason: "Implementation Run retried manually.",
        });
      await appendFacts(stores.events, this.dependencies, claimed, now, facts);
      return this.assignment(stores, checkpointedRun, claimed, project, profile);
    });
  }

  advance(
    runId: RunId,
    status: Extract<RunStatus, "preparing" | "running" | "publishing">,
    details: {
      readonly baseSha?: string;
      readonly headSha?: string;
      readonly logsStorageKey?: string;
      readonly summary?: string;
    } = {},
  ): Promise<Run> {
    return this.unitOfWork.execute(async (stores) => {
      const run = transitionRun(
        await requiredRun(stores.runs, runId),
        status,
        timestamp(this.dependencies.clock),
        details,
      );
      await stores.runs.update(run);
      return run;
    });
  }

  heartbeat(runId: RunId): Promise<Run> {
    return this.unitOfWork.execute(async (stores) => {
      const run = heartbeatRun(
        await requiredRun(stores.runs, runId),
        timestamp(this.dependencies.clock),
      );
      await stores.runs.update(run);
      return run;
    });
  }

  async reconcileStale(before: string): Promise<readonly Run[]> {
    const stale = await this.unitOfWork.execute((stores) => stores.runs.listStaleActive(before));
    const recovered: Run[] = [];
    for (const run of stale) {
      recovered.push(
        await this.fail(run.id, {
          errorCode: "runner_heartbeat_timeout",
          errorMessage: "Runner heartbeat expired; manual retry is required.",
        }),
      );
    }
    return recovered;
  }

  complete(
    runId: RunId,
    input: { readonly prUrl: string; readonly headSha: string; readonly summary: string },
  ): Promise<Run> {
    return this.finish(runId, "succeeded", input);
  }

  completeCuration(
    runId: RunId,
    input:
      | {
          readonly outcome: "ready";
          readonly title?: string;
          readonly curatorSpec: string;
          readonly summary: string;
        }
      | {
          readonly outcome: "blocked";
          readonly title?: string;
          readonly curatorSpec?: string;
          readonly questions: readonly {
            readonly text: string;
            readonly type: QuestionType;
            readonly options: readonly { readonly label: string }[];
            readonly allowOther: boolean;
          }[];
          readonly summary: string;
        },
  ): Promise<Run> {
    return this.unitOfWork.execute(async (stores) => {
      const current = await requiredRun(stores.runs, runId);
      if (current.kind !== "curation") {
        throw new ValidationError([{ path: "runId", message: "Run is not a curation Run." }]);
      }
      const task = await requiredTask(stores.tasks, current.taskId);
      assertVersion(task, current.taskVersion);
      if (
        input.outcome === "blocked" &&
        (input.questions.length < 1 || input.questions.length > 10)
      ) {
        throw new ValidationError([
          { path: "questions", message: "Blocked curation requires between 1 and 10 Questions." },
        ]);
      }
      const now = timestamp(this.dependencies.clock);
      const nextTask = completeCurationTask(
        task,
        input.outcome,
        {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.curatorSpec === undefined ? {} : { curatorSpec: input.curatorSpec }),
        },
        now,
      );
      const questions =
        input.outcome === "blocked"
          ? input.questions.map((definition) =>
              createQuestion({
                id: this.dependencies.ids.questionId(),
                taskId: task.id,
                cycleId: task.currentCycleId,
                text: definition.text,
                type: definition.type,
                options: definition.options.map((option, position) => ({
                  id: this.dependencies.ids.optionId(),
                  label: option.label,
                  position,
                })),
                allowOther: definition.allowOther,
                now,
              }),
            )
          : [];
      const run = transitionRun(current, "succeeded", now, {
        outcome: input.outcome,
        summary: input.summary,
      });
      if (!(await stores.tasks.updateIfVersion(nextTask, task.version)))
        throw new VersionConflictError(task.version);
      const facts: TaskEventFact[] = [];
      if (input.curatorSpec !== undefined) {
        const revision = await stores.specRevisions.nextRevision(task.id, task.currentCycleId);
        const specRevision = {
          id: this.dependencies.ids.specRevisionId(),
          taskId: task.id,
          cycleId: task.currentCycleId,
          revision,
          content: nextTask.curatorSpec,
          createdAt: now,
        };
        await stores.specRevisions.insert(specRevision);
        facts.push({
          type: "spec_revision_created",
          specRevisionId: specRevision.id,
          cycleId: task.currentCycleId,
          revision,
        });
      }
      for (const question of questions) await stores.questions.insert(question);
      await stores.runs.update(run);
      if (input.title !== undefined) facts.push({ type: "task_updated", fields: ["title"] });
      if (input.curatorSpec !== undefined)
        facts.push({ type: "spec_updated", spec: nextTask.curatorSpec });
      for (const question of questions)
        facts.push({
          type: "question_created",
          questionId: question.id,
          questionType: question.type,
          optionCount: question.options.length,
          allowOther: question.allowOther,
        });
      facts.push({
        type: "status_changed",
        from: "curating",
        to: input.outcome,
        automatic: true,
        reason: "Curation Run applied structured output.",
      });
      facts.push({ type: "run_succeeded", runId });
      await appendFacts(stores.events, this.dependencies, nextTask, now, facts);
      return run;
    });
  }

  fail(
    runId: RunId,
    input: { readonly errorCode: string; readonly errorMessage: string; readonly summary?: string },
  ): Promise<Run> {
    return this.finish(runId, "failed", input);
  }

  cancel(runId: RunId, reason: string, expectedVersion: number): Promise<Run> {
    return this.finish(
      runId,
      "cancelled",
      { errorCode: "cancelled", errorMessage: reason },
      expectedVersion,
    );
  }

  private finish(
    runId: RunId,
    status: Extract<RunStatus, "succeeded" | "failed" | "cancelled">,
    details: {
      readonly prUrl?: string;
      readonly headSha?: string;
      readonly summary?: string;
      readonly errorCode?: string;
      readonly errorMessage?: string;
    },
    expectedVersion?: number,
  ): Promise<Run> {
    return this.unitOfWork.execute(async (stores) => {
      const current = await requiredRun(stores.runs, runId);
      const task = await requiredTask(stores.tasks, current.taskId);
      if (expectedVersion !== undefined) assertVersion(task, expectedVersion);
      const now = timestamp(this.dependencies.clock);
      if (current.kind === "curation" && status === "succeeded") {
        throw new ValidationError([
          { path: "status", message: "Curation succeeds through structured completion." },
        ]);
      }
      if (current.kind === "implementation") assertVersion(task, current.taskVersion);
      const nextTask =
        current.kind === "curation"
          ? failCurationTask(task, now)
          : status === "succeeded"
            ? completeAutomatedTask(task, details.prUrl ?? "", now)
            : failAutomatedTask(task, now);
      const run = transitionRun(current, status, now, {
        ...(details.prUrl === undefined ? {} : { prUrl: details.prUrl }),
        ...(details.headSha === undefined ? {} : { headSha: details.headSha }),
        ...(details.summary === undefined ? {} : { summary: details.summary }),
        ...(details.errorCode === undefined ? {} : { errorCode: details.errorCode }),
        ...(details.errorMessage === undefined ? {} : { errorMessage: details.errorMessage }),
      });
      if (!(await stores.tasks.updateIfVersion(nextTask, task.version)))
        throw new VersionConflictError(task.version);
      if (current.kind === "implementation" && status === "succeeded") {
        const cycle = await stores.cycles.getById(task.currentCycleId);
        if (cycle !== null) await stores.cycles.update({ ...cycle, completedAt: now });
        if (task.currentDeliveryId !== null) {
          const delivery = await stores.deliveries.getById(task.currentDeliveryId);
          if (delivery !== null)
            await stores.deliveries.update({
              ...delivery,
              prUrl: details.prUrl ?? delivery.prUrl,
              updatedAt: now,
            });
        }
      }
      await stores.runs.update(run);
      const facts: TaskEventFact[] =
        current.kind === "curation"
          ? [
              {
                type: status === "failed" ? "run_failed" : "run_cancelled",
                runId,
                ...(details.errorMessage === undefined ? {} : { reason: details.errorMessage }),
              },
            ]
          : status === "succeeded"
            ? [
                { type: "pr_url_updated", present: true },
                {
                  type: "status_changed",
                  from: "implementing",
                  to: "done",
                  automatic: true,
                  reason: "Automated Run published a pull request.",
                },
                { type: "run_succeeded", runId },
              ]
            : [
                {
                  type: "status_changed",
                  from: "implementing",
                  to: "ready",
                  automatic: true,
                  reason: details.errorMessage ?? status,
                },
                {
                  type: status === "failed" ? "run_failed" : "run_cancelled",
                  runId,
                  ...(details.errorMessage === undefined ? {} : { reason: details.errorMessage }),
                },
              ];
      await appendFacts(stores.events, this.dependencies, nextTask, now, facts);
      return run;
    });
  }

  private async assignment(
    stores: import("../ports/stores.ts").Stores,
    run: Run,
    task: Task,
    project: import("../domain/project.ts").Project,
    agentProfile: AgentProfile,
  ): Promise<RunAssignment> {
    const [questions, attachments, cycles, messages, specRevisions, delivery] = await Promise.all([
      stores.questions.listByTaskId(task.id),
      stores.attachments.listByTaskId(task.id),
      stores.cycles.listByTaskId(task.id),
      stores.messages.listByTaskId(task.id),
      stores.specRevisions.listByTaskId(task.id),
      task.currentDeliveryId === null
        ? Promise.resolve(null)
        : stores.deliveries.getById(task.currentDeliveryId),
    ]);
    return {
      run,
      task: {
        ...task,
        questions,
        attachments: attachments.map(({ storageKey: _storageKey, ...attachment }) => attachment),
        cycles,
        messages,
        specRevisions,
      },
      project,
      agentProfile,
      delivery,
    };
  }
}

async function appendFacts(
  store: import("../ports/stores.ts").TaskEventStore,
  dependencies: CoreDependencies,
  task: Task,
  now: string,
  facts: readonly TaskEventFact[],
): Promise<void> {
  await store.append(
    await Promise.all(
      facts.map((fact) =>
        createTaskEvent(fact, {
          id: dependencies.ids.eventId(),
          taskId: task.id,
          taskVersion: task.version,
          actorType: "system",
          createdAt: now,
        }),
      ),
    ),
  );
}

async function requiredRun(store: import("../ports/stores.ts").RunStore, id: RunId): Promise<Run> {
  const run = await store.getById(id);
  if (run === null) throw new NotFoundError("Run", id);
  return run;
}
async function requiredTask(
  store: import("../ports/stores.ts").TaskStore,
  id: TaskId,
): Promise<Task> {
  const task = await store.getById(id);
  if (task === null) throw new NotFoundError("Task", id);
  return task;
}
async function requiredProject(
  store: import("../ports/stores.ts").ProjectStore,
  id: import("../domain/ids.ts").ProjectId,
) {
  const project = await store.getById(id);
  if (project === null) throw new NotFoundError("Project", id);
  return project;
}
function assertVersion(task: Task, expected: number): void {
  if (task.version !== expected) throw new VersionConflictError(expected, task.version);
}

export function scheduleMatches(cron: string | null, timezone: string, date: Date): boolean {
  if (cron === null) return true;
  const parts = cron.trim().split(/\s+/u);
  if (parts.length !== 5) return false;
  const values = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    minute: "2-digit",
    hour: "2-digit",
    day: "2-digit",
    month: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    values.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday"));
  return [
    Number(value("minute")),
    Number(value("hour")),
    Number(value("day")),
    Number(value("month")),
    weekday,
  ].every((number, index) => cronFieldMatches(parts[index] ?? "", number));
}

function cronFieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  return field.split(",").some((item) => {
    const step = /^\*\/(\d+)$/u.exec(item);
    if (step?.[1] !== undefined) return value % Number(step[1]) === 0;
    const range = /^(\d+)-(\d+)$/u.exec(item);
    if (range?.[1] !== undefined && range[2] !== undefined)
      return value >= Number(range[1]) && value <= Number(range[2]);
    return Number(item) === value;
  });
}
