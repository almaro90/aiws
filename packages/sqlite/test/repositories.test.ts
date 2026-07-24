import { afterEach, describe, expect, test } from "bun:test";
import type { Project, ProjectId, Task, TaskEvent, TaskEventId, TaskId } from "@aiws/core";
import { ValidationError } from "@aiws/core";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, SqliteUnitOfWork } from "../src/index.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function setup(): { database: Database; unitOfWork: SqliteUnitOfWork } {
  const directory = mkdtempSync(join(tmpdir(), "aiws-repositories-"));
  temporaryDirectories.push(directory);
  const database = openDatabase({ path: join(directory, "aiws.sqlite") });
  return { database, unitOfWork: new SqliteUnitOfWork(database) };
}

function projectId(value: number): ProjectId {
  return `prj_${String(value).padStart(26, "0")}` as ProjectId;
}

function taskId(value: number): TaskId {
  return `tsk_${String(value).padStart(26, "0")}` as TaskId;
}

function eventId(value: number): TaskEventId {
  return `evt_${String(value).padStart(26, "0")}` as TaskEventId;
}

function project(value = 1, changes: Partial<Project> = {}): Project {
  const timestamp = "2026-07-21T10:00:00.000Z";
  return {
    id: projectId(value),
    name: `Project ${value}`,
    description: "",
    repositoryPath: `/repos/${value}`,
    gitProvider: "github",
    accountScope: "personal",
    repositoryMode: "local",
    connectionId: null,
    remoteRepositoryId: null,
    remoteFullName: null,
    remoteWebUrl: null,
    defaultBranch: null,
    automationEnabled: false,
    curationAgentProfileId: null,
    implementationAgentProfileId: null,
    scheduleCron: null,
    scheduleTimezone: "UTC",
    maxConcurrency: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    ...changes,
  };
}

function task(value: number, owner = projectId(1), changes: Partial<Task> = {}): Task {
  const timestamp = new Date(Date.UTC(2026, 6, 21, 10, 0, value)).toISOString();
  return {
    id: taskId(value),
    projectId: owner,
    title: `Task ${value}`,
    userRequest: `Request ${value}`,
    curatorSpec: "",
    status: "draft",
    prUrl: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    automationPaused: false,
    currentCycleId: `cyc_${taskId(value).slice(4)}` as never,
    currentDeliveryId: null,
    ...changes,
  };
}

function event(value: number, owner: TaskId, createdAt: string): TaskEvent {
  return {
    id: eventId(value),
    taskId: owner,
    type: "task_created",
    actorType: "cli",
    metadata: { taskVersion: 1 },
    createdAt,
  };
}

describe("SQLite repositories and UnitOfWork", () => {
  test("round-trips Project, Task and Event rows through domain mappers", async () => {
    const { unitOfWork } = setup();
    const expectedProject = project();
    const expectedTask = task(1);
    const expectedEvent = event(1, expectedTask.id, expectedTask.createdAt);

    await unitOfWork.execute(async (stores) => {
      await stores.projects.insert(expectedProject);
      await stores.tasks.insert(expectedTask);
      await stores.events.append([expectedEvent]);
    });
    await unitOfWork.execute(async (stores) => {
      expect(await stores.projects.getById(expectedProject.id)).toEqual(expectedProject);
      expect(await stores.tasks.getById(expectedTask.id)).toEqual(expectedTask);
      expect(await stores.events.list({ taskId: expectedTask.id, limit: 50 })).toEqual({
        items: [expectedEvent],
        nextCursor: null,
      });
    });
    await unitOfWork.close();
  });

  test("rolls back Task mutation and Event append as one transaction", async () => {
    const { unitOfWork } = setup();
    const expectedProject = project();
    const original = task(1);
    const duplicateEvent = event(1, original.id, original.createdAt);
    await unitOfWork.execute(async (stores) => {
      await stores.projects.insert(expectedProject);
      await stores.tasks.insert(original);
      await stores.events.append([duplicateEvent]);
    });

    await expect(
      unitOfWork.execute(async (stores) => {
        const updated = { ...original, title: "Must rollback", version: 2 };
        expect(await stores.tasks.updateIfVersion(updated, 1)).toBe(true);
        await stores.events.append([duplicateEvent]);
      }),
    ).rejects.toThrow();
    await unitOfWork.execute(async (stores) => {
      expect(await stores.tasks.getById(original.id)).toEqual(original);
      expect((await stores.events.list({ taskId: original.id, limit: 50 })).items).toHaveLength(1);
    });
    await unitOfWork.close();
  });

  test("uses compare-and-swap and requires exactly one version increment", async () => {
    const { unitOfWork } = setup();
    const original = task(1);
    await unitOfWork.execute(async (stores) => {
      await stores.projects.insert(project());
      await stores.tasks.insert(original);
    });
    await unitOfWork.execute(async (stores) => {
      await expect(stores.tasks.updateIfVersion({ ...original, version: 3 }, 1)).rejects.toThrow();
      expect(
        await stores.tasks.updateIfVersion({ ...original, title: "Winner", version: 2 }, 1),
      ).toBe(true);
      expect(
        await stores.tasks.updateIfVersion({ ...original, title: "Loser", version: 2 }, 1),
      ).toBe(false);
    });
    await unitOfWork.close();
  });

  test("compare-and-swap cannot mutate an archived Task", async () => {
    const { unitOfWork } = setup();
    const archived = task(1, projectId(1), {
      archivedAt: "2026-07-21T11:00:00.000Z",
    });
    await unitOfWork.execute(async (stores) => {
      await stores.projects.insert(project());
      await stores.tasks.insert(archived);
      expect(
        await stores.tasks.updateIfVersion(
          {
            ...archived,
            title: "Must not change",
            version: 2,
            updatedAt: "2026-07-21T12:00:00.000Z",
          },
          1,
        ),
      ).toBe(false);
      expect(await stores.tasks.getById(archived.id)).toEqual(archived);
    });
    await unitOfWork.close();
  });

  test("serializes asynchronous BEGIN IMMEDIATE units of work on one connection", async () => {
    const { unitOfWork } = setup();
    const order: string[] = [];
    const first = unitOfWork.execute(async (stores) => {
      order.push("first:start");
      await Bun.sleep(5);
      await stores.projects.insert(project(1));
      order.push("first:end");
    });
    const second = unitOfWork.execute(async (stores) => {
      order.push("second:start");
      await stores.projects.insert(project(2));
      order.push("second:end");
    });
    await Promise.all([first, second]);

    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
    await unitOfWork.close();
  });

  test("paginates 250 Tasks without omissions or duplicates in both directions", async () => {
    const { unitOfWork } = setup();
    await unitOfWork.execute(async (stores) => {
      await stores.projects.insert(project());
      for (let index = 1; index <= 250; index += 1) {
        const sharedTimestamp = new Date(
          Date.UTC(2026, 6, 21, 10, 0, Math.floor(index / 3)),
        ).toISOString();
        await stores.tasks.insert(
          task(index, projectId(1), { createdAt: sharedTimestamp, updatedAt: sharedTimestamp }),
        );
      }
    });

    for (const order of ["asc", "desc"] as const) {
      const ids: TaskId[] = [];
      let cursor: string | undefined;
      do {
        const page = await unitOfWork.execute(async (stores) =>
          stores.tasks.list({
            archived: false,
            sort: "createdAt",
            order,
            limit: 50,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        );
        ids.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      expect(ids).toHaveLength(250);
      expect(new Set(ids).size).toBe(250);
      expect(ids[0]).toBe(order === "asc" ? taskId(1) : taskId(250));
    }
    await unitOfWork.close();
  });

  test("filters indexed Project and Task queries and rejects incompatible cursors", async () => {
    const { unitOfWork } = setup();
    await unitOfWork.execute(async (stores) => {
      await stores.projects.insert(project(1));
      await stores.projects.insert(
        project(2, {
          gitProvider: "gitlab",
          accountScope: "work",
          updatedAt: "2026-07-21T11:00:00.000Z",
        }),
      );
      await stores.projects.insert(
        project(3, {
          archivedAt: "2026-07-21T12:00:00.000Z",
          updatedAt: "2026-07-21T12:00:00.000Z",
        }),
      );
      await stores.tasks.insert(task(1));
      await stores.tasks.insert(task(2, projectId(2), { status: "ready" }));
      await stores.tasks.insert(
        task(3, projectId(2), { status: "ready", archivedAt: "2026-07-21T12:00:00.000Z" }),
      );
    });

    await unitOfWork.execute(async (stores) => {
      const projects = await stores.projects.list({
        archived: false,
        gitProvider: "gitlab",
        accountScope: "work",
        limit: 50,
      });
      expect(projects.items.map((item) => item.id)).toEqual([projectId(2)]);
      const tasks = await stores.tasks.list({
        archived: false,
        statuses: ["ready"],
        accountScope: "work",
        gitProvider: "gitlab",
        sort: "createdAt",
        order: "asc",
        limit: 50,
      });
      expect(tasks.items).toHaveLength(1);
      expect(tasks.items[0]).toMatchObject({ id: taskId(2), projectName: "Project 2" });
      expect(
        (
          await stores.tasks.list({
            archived: true,
            sort: "updatedAt",
            order: "desc",
            limit: 50,
          })
        ).items.map((item) => item.id),
      ).toEqual([taskId(3)]);

      const first = await stores.tasks.list({
        archived: false,
        sort: "createdAt",
        order: "asc",
        limit: 1,
      });
      expect(first.nextCursor).not.toBeNull();
      await expect(
        stores.tasks.list({
          archived: false,
          sort: "updatedAt",
          order: "asc",
          limit: 1,
          cursor: first.nextCursor ?? "",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
    await unitOfWork.close();
  });

  test("paginates activity and counts open Questions", async () => {
    const { database, unitOfWork } = setup();
    const owner = task(1);
    await unitOfWork.execute(async (stores) => {
      await stores.projects.insert(project());
      await stores.tasks.insert(owner);
      await stores.events.append([
        event(1, owner.id, "2026-07-21T10:00:00.000Z"),
        event(2, owner.id, "2026-07-21T10:00:00.000Z"),
        event(3, owner.id, "2026-07-21T11:00:00.000Z"),
      ]);
    });
    database.run(
      `INSERT INTO questions(
        id, task_id, text, type, options_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'text', '[]', 'open', ?, ?)`,
      ["qst_00000000000000000000000001", owner.id, "Question?", owner.createdAt, owner.createdAt],
    );

    await unitOfWork.execute(async (stores) => {
      const first = await stores.events.list({ taskId: owner.id, limit: 2 });
      expect(first.items.map((item) => item.id)).toEqual([eventId(3), eventId(2)]);
      expect(first.nextCursor).not.toBeNull();
      const second = await stores.events.list({
        taskId: owner.id,
        limit: 2,
        cursor: first.nextCursor ?? "",
      });
      expect(second.items.map((item) => item.id)).toEqual([eventId(1)]);
      expect(await stores.questions.countOpenByTaskId(owner.id)).toBe(1);
    });
    await unitOfWork.close();
  });

  test("target queries use their documented indexes", async () => {
    const { database, unitOfWork } = setup();
    const plans = [
      [
        "idx_projects_active_updated",
        "SELECT * FROM projects WHERE archived_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 51",
      ],
      [
        "idx_projects_provider_scope",
        `SELECT * FROM projects WHERE archived_at IS NULL AND git_provider = 'github'
         AND account_scope = 'personal' ORDER BY updated_at DESC, id DESC LIMIT 51`,
      ],
      [
        "idx_tasks_active_updated",
        "SELECT * FROM tasks WHERE archived_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 51",
      ],
      [
        "idx_tasks_active_status_created",
        `SELECT * FROM tasks WHERE archived_at IS NULL AND status = 'ready'
         ORDER BY created_at ASC, id ASC LIMIT 51`,
      ],
      [
        "idx_tasks_project_active_status",
        `SELECT * FROM tasks WHERE archived_at IS NULL AND project_id = 'prj_x' AND status = 'ready'
         ORDER BY updated_at DESC, id DESC LIMIT 51`,
      ],
      [
        "idx_tasks_archived_at",
        "SELECT * FROM tasks WHERE archived_at IS NOT NULL ORDER BY archived_at DESC, id DESC LIMIT 51",
      ],
      [
        "idx_questions_task_status",
        `SELECT * FROM questions WHERE task_id = 'tsk_x' AND status = 'open'
         ORDER BY created_at ASC, id ASC`,
      ],
      [
        "idx_attachments_task_created",
        "SELECT * FROM attachments WHERE task_id = 'tsk_x' ORDER BY created_at ASC, id ASC",
      ],
      [
        "idx_task_events_task_created",
        "SELECT * FROM task_events WHERE task_id = 'tsk_x' ORDER BY created_at DESC, id DESC",
      ],
    ] as const;

    for (const [index, sql] of plans) {
      const detail = database
        .query<{ detail: string }, []>(`EXPLAIN QUERY PLAN ${sql}`)
        .all()
        .map((row) => row.detail)
        .join(" ");
      expect(detail).toContain(index);
    }
    await unitOfWork.close();
    expect(() => database.query("SELECT 1").get()).toThrow();
  });
});
