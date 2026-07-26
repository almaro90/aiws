import { afterEach, describe, expect, test } from "bun:test";
import { ProjectUseCases, SystemClock, TaskUseCases, UlidIdGenerator } from "@aiws/core";
import { openDatabase, SqliteUnitOfWork } from "@aiws/sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttentionService } from "../src/attention.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("attention projection", () => {
  test("deduplicates Task symptoms, excludes archived records and paginates the runner singleton", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aiws-attention-"));
    directories.push(directory);
    const database = openDatabase({ path: join(directory, "aiws.sqlite") });
    const unitOfWork = new SqliteUnitOfWork(database);
    const clock = new SystemClock();
    const ids = new UlidIdGenerator(clock);
    const projects = new ProjectUseCases(unitOfWork, { clock, ids });
    const tasks = new TaskUseCases(unitOfWork, { clock, ids });
    const project = await projects.create({
      name: "Attention",
      repositoryPath: "/repos/attention",
      gitProvider: "other",
      accountScope: "work",
    });
    const task = await tasks.create({
      projectId: project.id,
      userRequest: "Needs a decision",
      actorType: "web",
    });
    database
      .query<void, [string]>(
        "UPDATE tasks SET status = 'curating', curator_spec = 'Prepared', ready_approval_pending = 1, automation_paused = 1 WHERE id = ?",
      )
      .run(task.id);
    const service = new AttentionService(database);
    const runner = {
      status: "offline" as const,
      lastSeenAt: "2026-07-26T10:00:00.000Z",
      offlineAfterSeconds: 45,
    };
    const first = service.list({ limit: 1, runner });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    if (first.nextCursor === null) throw new Error("Expected a second attention page.");
    const second = service.list({ limit: 10, cursor: first.nextCursor, runner });
    const all = [...first.items, ...second.items];
    expect(all.filter((item) => item.taskId === task.id)).toHaveLength(1);
    expect(all.find((item) => item.taskId === task.id)?.reason).toBe("approval_pending");
    expect(all.filter((item) => item.reason === "runner_unavailable")).toHaveLength(1);
    database
      .query<void, [string, string, string]>(
        "UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ?",
      )
      .run("2026-07-26T11:00:00.000Z", "2026-07-26T11:00:00.000Z", task.id);
    expect(service.list({ limit: 10, runner }).items.some((item) => item.taskId === task.id)).toBe(
      false,
    );
    expect(() => service.list({ limit: 10, cursor: "invalid", runner })).toThrow(
      "Invalid attention cursor",
    );
    await unitOfWork.close();
  });
});
