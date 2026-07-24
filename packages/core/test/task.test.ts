import { describe, expect, test } from "bun:test";
import {
  archiveTask,
  createTask,
  createTaskEvent,
  generateTaskTitle,
  InvalidTransitionError,
  type ProjectId,
  type TaskEventId,
  type TaskId,
  TASK_STATUSES,
  type TaskStatus,
  transitionTask,
  unarchiveTask,
  updateTask,
  ValidationError,
} from "../src/index.ts";

const taskId = "tsk_01K0ABCDEFGHIJKLMNOPQRSTUV" as TaskId;
const projectId = "prj_01K0ABCDEFGHIJKLMNOPQRSTUV" as ProjectId;
const eventId = "evt_01K0ABCDEFGHIJKLMNOPQRSTUV" as TaskEventId;
const now = "2026-07-21T10:00:00.000Z";

function task(overrides = {}) {
  return {
    ...createTask({ id: taskId, projectId, userRequest: "Fix export", now }),
    ...overrides,
  };
}

describe("Task creation and updates", () => {
  test("creates version 1 in Draft with immutable request and empty spec", () => {
    const created = task();
    expect(created).toMatchObject({
      userRequest: "Fix export",
      title: "Fix export",
      curatorSpec: "",
      status: "draft",
      prUrl: null,
      version: 1,
      archivedAt: null,
    });
  });

  test("generates title from the first non-empty line, normalizes whitespace and truncates", () => {
    const request = `\n \n  A   title\twith spaces ${"x".repeat(140)}\nSecond line`;
    const title = generateTaskTitle(request);
    expect(title.startsWith("A title with spaces ")).toBe(true);
    expect(Array.from(title)).toHaveLength(120);
  });

  test.each([
    ["blank request", { userRequest: " \n " }],
    ["long request", { userRequest: "x".repeat(100_001) }],
    ["blank title", { title: " " }],
    ["long title", { title: "x".repeat(201) }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      createTask({ id: taskId, projectId, userRequest: "ok", now, ...override }),
    ).toThrow(ValidationError);
  });

  test("can edit userRequest in Draft and freezes it after entering Curating", () => {
    const edited = updateTask(
      task(),
      { userRequest: "replacement" },
      "2026-07-21T11:00:00.000Z",
    ).task;
    expect(edited.userRequest).toBe("replacement");
    expect(() =>
      updateTask({ ...edited, status: "curating" }, { userRequest: "again" }, now),
    ).toThrow(ValidationError);
  });

  test("one update with several fields increments version exactly once", () => {
    const result = updateTask(
      task(),
      { title: "Export phone", curatorSpec: "# Plan", prUrl: "https://example.com/pr/1" },
      "2026-07-21T11:00:00.000Z",
    );
    expect(result.task.version).toBe(2);
    expect(result.changedFields).toEqual(["title", "curatorSpec", "prUrl"]);
  });

  test.each(["ftp://example.com/pr/1", "relative/path", "mailto:a@example.com"])(
    "rejects non HTTP PR URL %s",
    (prUrl) => expect(() => updateTask(task(), { prUrl }, now)).toThrow(ValidationError),
  );

  test("sets, replaces and clears the single external PR URL", () => {
    const set = updateTask(task(), { prUrl: "https://example.com/pr/1" }, now).task;
    const replaced = updateTask(set, { prUrl: "http://example.com/pr/2" }, now).task;
    const cleared = updateTask(replaced, { prUrl: null }, now).task;
    expect(cleared.prUrl).toBeNull();
  });

  test.each(["ready", "implementing", "done"] as const)(
    "rejects an empty spec while %s",
    (status) => {
      expect(() =>
        updateTask(task({ status, curatorSpec: "# Existing" }), { curatorSpec: " " }, now),
      ).toThrow(ValidationError);
    },
  );
});

describe("Task state machine", () => {
  const allowed = new Set([
    "draft:curating",
    "curating:ready",
    "ready:implementing",
    "implementing:done",
  ]);

  for (const from of TASK_STATUSES) {
    for (const to of TASK_STATUSES) {
      if (allowed.has(`${from}:${to}`)) continue;
      test(`rejects ${from} -> ${to}`, () => {
        expect(() =>
          transitionTask(task({ status: from, curatorSpec: "# Spec" }), from, to, 0, now),
        ).toThrow(InvalidTransitionError);
      });
    }
  }

  test.each([
    ["draft", "curating"],
    ["curating", "ready"],
    ["ready", "implementing"],
    ["implementing", "done"],
  ] as [TaskStatus, TaskStatus][])("allows %s -> %s and increments once", (from, to) => {
    const transitioned = transitionTask(
      task({ status: from, curatorSpec: "# Spec" }),
      from,
      to,
      0,
      now,
    );
    expect(transitioned.status).toBe(to);
    expect(transitioned.version).toBe(2);
  });

  test("rejects an incorrect declared source", () => {
    expect(() =>
      transitionTask(task({ curatorSpec: "# Spec" }), "ready", "implementing", 0, now),
    ).toThrow(InvalidTransitionError);
  });

  test("Ready requires spec and no open Questions", () => {
    expect(() => transitionTask(task({ status: "curating" }), "curating", "ready", 0, now)).toThrow(
      InvalidTransitionError,
    );
    expect(() =>
      transitionTask(
        task({ status: "curating", curatorSpec: "# Spec" }),
        "curating",
        "ready",
        1,
        now,
      ),
    ).toThrow(InvalidTransitionError);
  });

  test("Done does not require a PR", () => {
    const done = transitionTask(
      task({ status: "implementing", curatorSpec: "# Spec", prUrl: null }),
      "implementing",
      "done",
      0,
      now,
    );
    expect(done.status).toBe("done");
    expect(done.prUrl).toBeNull();
  });
});

describe("Task archive and event metadata", () => {
  test("archive preserves state and unarchive increments once each", () => {
    const archived = archiveTask(task({ status: "ready", curatorSpec: "# Spec" }), now);
    expect(archived).toMatchObject({ status: "ready", version: 2, archivedAt: now });
    expect(() => updateTask(archived, { title: "No" }, now)).toThrow(InvalidTransitionError);
    const restored = unarchiveTask(archived, "2026-07-21T12:00:00.000Z");
    expect(restored).toMatchObject({ status: "ready", version: 3, archivedAt: null });
  });

  test("spec event contains byte length and SHA-256 but not content", async () => {
    const event = await createTaskEvent(
      { type: "spec_updated", spec: "abc" },
      { id: eventId, taskId, taskVersion: 2, actorType: "cli", createdAt: now },
    );
    expect(event.metadata).toEqual({
      taskVersion: 2,
      length: 3,
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    expect(JSON.stringify(event)).not.toContain("abc");
  });
});
