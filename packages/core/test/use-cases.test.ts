import { beforeEach, describe, expect, test } from "bun:test";
import {
  type Clock,
  createProject,
  type Delivery,
  InvalidTransitionError,
  type Project,
  ProjectHasActiveTasksError,
  type ProjectId,
  ProjectUseCases,
  type Stores,
  type Task,
  type TaskEvent,
  TaskUseCases,
  type UnitOfWork,
  UlidIdGenerator,
  ValidationError,
  VersionConflictError,
} from "../src/index.ts";

class FixedClock implements Clock {
  constructor(readonly instant = new Date("2026-07-21T10:00:00.000Z")) {}

  now(): Date {
    return new Date(this.instant);
  }
}

class MemoryUnitOfWork implements UnitOfWork {
  readonly projects = new Map<ProjectId, Project>();
  readonly tasks = new Map<string, Task>();
  readonly events: TaskEvent[] = [];
  readonly deliveries = new Map<string, Delivery>();
  openQuestions = 0;
  forceCompareAndSwapConflict = false;

  readonly stores: Stores = {
    projects: {
      getById: async (id) => this.projects.get(id) ?? null,
      list: async () => ({ items: [...this.projects.values()], nextCursor: null }),
      repositoryPathExists: async (path, excludingId) =>
        [...this.projects.values()].some(
          (project) => project.repositoryPath === path && project.id !== excludingId,
        ),
      insert: async (project) => {
        this.projects.set(project.id, project);
      },
      update: async (project) => {
        this.projects.set(project.id, project);
      },
      countActiveTasks: async (projectId) =>
        [...this.tasks.values()].filter(
          (task) => task.projectId === projectId && task.archivedAt === null,
        ).length,
    },
    tasks: {
      getById: async (id) => this.tasks.get(id) ?? null,
      list: async () => ({ items: [], nextCursor: null }),
      insert: async (task) => {
        this.tasks.set(task.id, task);
      },
      updateIfVersion: async (task, expectedVersion) => {
        const current = this.tasks.get(task.id);
        if (
          this.forceCompareAndSwapConflict ||
          current === undefined ||
          current.version !== expectedVersion
        ) {
          return false;
        }
        this.tasks.set(task.id, task);
        return true;
      },
      listAutomationCandidates: async () => [],
      listCurationCandidates: async () => [],
    },
    questions: {
      getById: async () => null,
      countOpenByTaskId: async () => this.openQuestions,
      listByTaskId: async () => [],
      insert: async () => {},
      update: async () => {},
    },
    attachments: {
      getById: async () => null,
      countByTaskId: async () => 0,
      listByTaskId: async () => [],
      insert: async () => {},
      remove: async () => false,
    },
    events: {
      append: async (events) => {
        this.events.push(...events);
      },
      list: async () => ({ items: [...this.events], nextCursor: null }),
    },
    connections: {
      getById: async () => null,
      list: async () => [],
      findByInstallation: async () => null,
      insert: async () => {},
      update: async () => {},
    },
    agentProfiles: {
      getById: async () => null,
      list: async () => [],
      nameExists: async () => false,
      insert: async () => {},
      update: async () => {},
    },
    runs: {
      getById: async () => null,
      getNextQueued: async () => null,
      listByTaskId: async () => [],
      listStaleActive: async () => [],
      countActiveByProject: async () => 0,
      nextAttempt: async () => 1,
      insert: async () => {},
      update: async () => {},
    },
    cycles: {
      getById: async (id) => ({
        id,
        taskId: [...this.tasks.values()][0]?.id as never,
        number: 1,
        deliveryId: null,
        createdAt: "2026-07-21T10:00:00.000Z",
        completedAt: null,
      }),
      listByTaskId: async () => [],
      nextNumber: async () => 1,
      insert: async () => {},
      update: async () => {},
    },
    messages: { getById: async () => null, listByTaskId: async () => [], insert: async () => {} },
    specRevisions: {
      listByTaskId: async () => [],
      nextRevision: async () => 1,
      insert: async () => {},
    },
    questionAnswers: {
      listByQuestionId: async () => [],
      nextRevision: async () => 1,
      insert: async () => {},
    },
    deliveries: {
      getById: async (id) => this.deliveries.get(id) ?? null,
      insert: async (delivery) => {
        this.deliveries.set(delivery.id, delivery);
      },
      update: async (delivery) => {
        this.deliveries.set(delivery.id, delivery);
      },
    },
    timeline: { list: async () => ({ items: [], nextCursor: null }) },
  };

  execute<T>(work: (stores: Stores) => Promise<T>): Promise<T> {
    return work(this.stores);
  }
}

describe("Project use cases", () => {
  let memory: MemoryUnitOfWork;
  let projects: ProjectUseCases;

  beforeEach(() => {
    memory = new MemoryUnitOfWork();
    const clock = new FixedClock();
    projects = new ProjectUseCases(memory, { clock, ids: new UlidIdGenerator(clock) });
  });

  test("enforces repository path uniqueness including archived Projects", async () => {
    const first = await projects.create({
      name: "One",
      repositoryPath: "/srv/repos/one",
      gitProvider: "github",
      accountScope: "personal",
    });
    await projects.archive(first.id);

    expect(
      projects.create({
        name: "Duplicate",
        repositoryPath: "/srv/repos/one",
        gitProvider: "github",
        accountScope: "personal",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("does not archive a Project with active Tasks", async () => {
    const project = await projects.create({
      name: "One",
      repositoryPath: "/srv/repos/one",
      gitProvider: "other",
      accountScope: "work",
    });
    memory.tasks.set("task", {
      id: "tsk_01K0ABCDEFGHIJKLMNOPQRSTUV" as never,
      projectId: project.id,
      title: "Task",
      userRequest: "Task",
      curatorSpec: "",
      status: "draft",
      prUrl: null,
      version: 1,
      createdAt: "2026-07-21T10:00:00.000Z",
      updatedAt: "2026-07-21T10:00:00.000Z",
      archivedAt: null,
      automationPaused: false,
      currentCycleId: "cyc_01K0ABCDEFGHIJKLMNOPQRSTUV" as never,
      currentDeliveryId: null,
    });

    expect(projects.archive(project.id)).rejects.toBeInstanceOf(ProjectHasActiveTasksError);
  });
});

describe("Task use cases", () => {
  let memory: MemoryUnitOfWork;
  let tasks: TaskUseCases;
  let project: Project;

  beforeEach(() => {
    memory = new MemoryUnitOfWork();
    const clock = new FixedClock();
    const ids = new UlidIdGenerator(clock);
    tasks = new TaskUseCases(memory, { clock, ids });
    project = createProject({
      id: ids.projectId(),
      name: "AIWS",
      repositoryPath: "/srv/repos/aiws",
      gitProvider: "github",
      accountScope: "personal",
      now: clock.now().toISOString(),
    });
    memory.projects.set(project.id, project);
  });

  test("creates Task and safe event in one unit of work", async () => {
    const created = await tasks.create({
      projectId: project.id,
      userRequest: "Sensitive original request",
      actorType: "web",
    });

    expect(created.version).toBe(1);
    expect(memory.events).toHaveLength(1);
    expect(memory.events[0]).toMatchObject({
      taskId: created.id,
      type: "task_created",
      actorType: "web",
      metadata: { taskVersion: 1 },
    });
    expect(JSON.stringify(memory.events)).not.toContain("Sensitive original request");
  });

  test("snapshots the selected managed Base Branch in a new Delivery", async () => {
    const clock = new FixedClock();
    const ids = new UlidIdGenerator(clock);
    const managed = createProject({
      id: ids.projectId(),
      name: "Managed",
      repositoryPath: "/srv/repos/managed",
      gitProvider: "github",
      accountScope: "personal",
      repositoryMode: "managed",
      connectionId: ids.connectionId(),
      remoteRepositoryId: "42",
      remoteFullName: "acme/managed",
      remoteWebUrl: "https://github.com/acme/managed",
      defaultBranch: "main",
      now: clock.now().toISOString(),
    });
    memory.projects.set(managed.id, managed);

    const created = await tasks.create({
      projectId: managed.id,
      userRequest: "Build from release",
      baseBranch: "release/next",
      actorType: "web",
    });

    expect(created.currentDelivery).toMatchObject({
      baseBranch: "release/next",
      branchName: `aiws/${created.id}/${created.currentDelivery?.id}`,
    });
  });

  test("rejects a managed Base Branch on a local Project", async () => {
    await expect(
      tasks.create({
        projectId: project.id,
        userRequest: "Invalid local branch",
        baseBranch: "main",
        actorType: "web",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("rejects Task creation for an archived Project", async () => {
    memory.projects.set(project.id, { ...project, archivedAt: "2026-07-21T10:00:00.000Z" });
    expect(
      tasks.create({ projectId: project.id, userRequest: "Task", actorType: "cli" }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  test("multi-field update increments once and emits safe, version-aligned events", async () => {
    const created = await tasks.create({
      projectId: project.id,
      userRequest: "Original",
      actorType: "cli",
    });
    const updated = await tasks.update({
      taskId: created.id,
      expectedVersion: 1,
      changes: {
        title: "Updated",
        curatorSpec: "secret implementation specification",
        prUrl: "https://example.com/pr/1",
      },
      actorType: "cli",
    });

    expect(updated.version).toBe(2);
    expect(memory.events.slice(1).map((event) => event.type)).toEqual([
      "task_updated",
      "spec_updated",
      "spec_revision_created",
      "delivery_created",
      "pr_url_updated",
    ]);
    expect(memory.events.slice(1).every((event) => event.metadata.taskVersion === 2)).toBe(true);
    expect(JSON.stringify(memory.events)).not.toContain("secret implementation specification");
    expect(JSON.stringify(memory.events)).not.toContain("https://example.com/pr/1");
  });

  test("expectedVersion mismatch fails before mutation", async () => {
    const created = await tasks.create({
      projectId: project.id,
      userRequest: "Original",
      actorType: "cli",
    });
    expect(
      tasks.update({
        taskId: created.id,
        expectedVersion: 2,
        changes: { title: "Lost write" },
        actorType: "cli",
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);
    expect(memory.tasks.get(created.id)?.title).toBe(created.title);
  });

  test("compare-and-swap conflict abstraction rejects a concurrent winner", async () => {
    const created = await tasks.create({
      projectId: project.id,
      userRequest: "Original",
      actorType: "cli",
    });
    memory.forceCompareAndSwapConflict = true;
    expect(
      tasks.update({
        taskId: created.id,
        expectedVersion: 1,
        changes: { title: "Concurrent" },
        actorType: "cli",
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);
    expect(memory.events).toHaveLength(1);
  });

  test("transition records reason and increments exactly once", async () => {
    const created = await tasks.create({
      projectId: project.id,
      userRequest: "Original",
      actorType: "cli",
    });
    const specified = await tasks.update({
      taskId: created.id,
      expectedVersion: 1,
      changes: { curatorSpec: "# Plan" },
      actorType: "cli",
    });
    const curating = await tasks.transition({
      taskId: created.id,
      expectedVersion: specified.version,
      from: "draft",
      to: "curating",
      reason: "Submitted",
      actorType: "web",
    });
    const ready = await tasks.transition({
      taskId: created.id,
      expectedVersion: curating.version,
      from: "curating",
      to: "ready",
      reason: "Curator approved",
      actorType: "web",
    });

    expect(ready.version).toBe(4);
    expect(memory.events.at(-1)).toMatchObject({
      type: "status_changed",
      metadata: {
        taskVersion: 4,
        from: "curating",
        to: "ready",
        automatic: false,
        reason: "Curator approved",
      },
    });
  });

  test("archive and unarchive preserve status and increment once", async () => {
    const created = await tasks.create({
      projectId: project.id,
      userRequest: "Original",
      actorType: "cli",
    });
    const archived = await tasks.archive({
      taskId: created.id,
      expectedVersion: 1,
      actorType: "cli",
    });
    const restored = await tasks.unarchive({
      taskId: created.id,
      expectedVersion: 2,
      actorType: "cli",
    });

    expect(archived).toMatchObject({ status: "draft", version: 2 });
    expect(restored).toMatchObject({ status: "draft", version: 3, archivedAt: null });
  });
});
