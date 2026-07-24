import { afterEach, describe, expect, test } from "bun:test";
import {
  type Clock,
  createProject,
  createQuestion,
  createTask,
  InvalidTransitionError,
  type QuestionId,
  QuestionUseCases,
  type QuestionOptionId,
  type Task,
  type TaskEvent,
  UlidIdGenerator,
  VersionConflictError,
} from "@aiws/core";
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

class FixedClock implements Clock {
  now(): Date {
    return new Date("2026-07-21T10:00:00.000Z");
  }
}

async function setup(status: Task["status"] = "curating") {
  const directory = mkdtempSync(join(tmpdir(), "aiws-questions-"));
  temporaryDirectories.push(directory);
  const unitOfWork = new SqliteUnitOfWork(openDatabase({ path: join(directory, "aiws.sqlite") }));
  const clock = new FixedClock();
  const ids = new UlidIdGenerator(clock);
  const project = createProject({
    id: ids.projectId(),
    name: "AIWS",
    repositoryPath: "/repos/aiws",
    gitProvider: "github",
    accountScope: "personal",
    now: clock.now().toISOString(),
  });
  const task = {
    ...createTask({
      id: ids.taskId(),
      projectId: project.id,
      userRequest: "Implement Questions",
      now: clock.now().toISOString(),
    }),
    status,
    curatorSpec:
      status === "draft" || status === "curating" || status === "blocked" ? "" : "# Spec",
  };
  await unitOfWork.execute(async (stores) => {
    await stores.projects.insert(project);
    await stores.tasks.insert(task);
  });
  return { unitOfWork, questions: new QuestionUseCases(unitOfWork, { clock, ids }), task, ids };
}

describe("Question SQLite workflow", () => {
  test("rolls back Question, Task version and events when the transaction fails", async () => {
    const fixture = await setup();
    try {
      const event: TaskEvent = {
        id: fixture.ids.eventId(),
        taskId: fixture.task.id,
        type: "task_created",
        actorType: "cli",
        metadata: { taskVersion: 1 },
        createdAt: fixture.task.createdAt,
      };
      await fixture.unitOfWork.execute((stores) => stores.events.append([event]));
      const question = createQuestion({
        id: fixture.ids.questionId(),
        taskId: fixture.task.id,
        text: "Must roll back",
        type: "text",
        options: [],
        allowOther: false,
        now: fixture.task.createdAt,
      });

      await expect(
        fixture.unitOfWork.execute(async (stores) => {
          expect(
            await stores.tasks.updateIfVersion(
              { ...fixture.task, status: "blocked", version: 2 },
              1,
            ),
          ).toBe(true);
          await stores.questions.insert(question);
          await stores.events.append([event]);
        }),
      ).rejects.toThrow();

      const stored = await fixture.unitOfWork.execute(async (stores) => ({
        task: await stores.tasks.getById(fixture.task.id),
        questions: await stores.questions.listByTaskId(fixture.task.id),
        events: (await stores.events.list({ taskId: fixture.task.id, limit: 50 })).items,
      }));
      expect(stored.task).toMatchObject({ status: "curating", version: 1 });
      expect(stored.questions).toEqual([]);
      expect(stored.events).toHaveLength(1);
    } finally {
      await fixture.unitOfWork.close();
    }
  });

  test("persists each mutation, one Task version and its events atomically", async () => {
    const fixture = await setup();
    try {
      const first = await fixture.questions.create({
        taskId: fixture.task.id,
        expectedVersion: 1,
        text: "Where?",
        type: "single_choice",
        options: [{ label: "Production" }, { label: "Test" }],
        allowOther: true,
        actorType: "cli",
      });
      expect(first).toMatchObject({ status: "blocked", version: 2 });
      expect(first.questions[0]?.options.map((option) => option.position)).toEqual([0, 1]);
      expect(new Set(first.questions[0]?.options.map((option) => option.id)).size).toBe(2);

      const second = await fixture.questions.create({
        taskId: fixture.task.id,
        expectedVersion: 2,
        text: "Extra context?",
        type: "text",
        options: [],
        allowOther: false,
        actorType: "web",
      });
      expect(second).toMatchObject({ status: "blocked", version: 3 });

      const firstQuestion = second.questions[0] as (typeof second.questions)[number];
      const secondQuestion = second.questions[1] as (typeof second.questions)[number];
      const answered = await fixture.questions.answer({
        taskId: fixture.task.id,
        questionId: firstQuestion.id,
        expectedVersion: 3,
        selectedOptionIds: [firstQuestion.options[0]?.id as QuestionOptionId],
        answerText: null,
        actorType: "cli",
      });
      expect(answered).toMatchObject({ status: "blocked", version: 4 });

      const resolved = await fixture.questions.dismiss({
        taskId: fixture.task.id,
        questionId: secondQuestion.id,
        expectedVersion: 4,
        reason: "No longer needed",
        actorType: "web",
      });
      expect(resolved).toMatchObject({ status: "curating", version: 5 });

      const reopened = await fixture.questions.reopen({
        taskId: fixture.task.id,
        questionId: firstQuestion.id,
        expectedVersion: 5,
        reason: "Review",
        actorType: "cli",
      });
      expect(reopened).toMatchObject({ status: "blocked", version: 6 });
      expect(reopened.questions[0]).toMatchObject({
        status: "open",
        selectedOptionIds: [firstQuestion.options[0]?.id],
        answeredAt: expect.any(String),
      });

      await expect(
        fixture.questions.update({
          taskId: fixture.task.id,
          questionId: firstQuestion.id,
          expectedVersion: 6,
          definition: {
            text: "Frozen",
            type: "text",
            options: [],
            allowOther: false,
          },
          actorType: "cli",
        }),
      ).rejects.toBeInstanceOf(InvalidTransitionError);

      const final = await fixture.questions.answer({
        taskId: fixture.task.id,
        questionId: firstQuestion.id,
        expectedVersion: 6,
        selectedOptionIds: [firstQuestion.options[1]?.id as QuestionOptionId],
        answerText: "Revised",
        actorType: "cli",
      });
      expect(final).toMatchObject({ status: "curating", version: 7 });

      const activity = await fixture.unitOfWork.execute((stores) =>
        stores.events.list({ taskId: fixture.task.id, limit: 50 }),
      );
      expect(activity.items.filter((event) => event.type === "status_changed")).toHaveLength(4);
      expect(
        activity.items
          .filter((event) => event.type === "status_changed")
          .every((event) => event.actorType === "system" && event.metadata.automatic === true),
      ).toBe(true);
      expect(activity.items.every((event) => !JSON.stringify(event).includes("Revised"))).toBe(
        true,
      );
    } finally {
      await fixture.unitOfWork.close();
    }
  });

  test.each(["ready", "implementing"] as const)(
    "creating from %s blocks without assigning Ready automatically",
    async (status) => {
      const fixture = await setup(status);
      try {
        const aggregate = await fixture.questions.create({
          taskId: fixture.task.id,
          expectedVersion: 1,
          text: "Block it",
          type: "text",
          options: [],
          allowOther: false,
          actorType: "cli",
        });
        expect(aggregate).toMatchObject({ status: "blocked", version: 2 });
        const returned = await fixture.questions.answer({
          taskId: fixture.task.id,
          questionId: aggregate.questions[0]?.id as QuestionId,
          expectedVersion: 2,
          selectedOptionIds: [],
          answerText: "Resolved",
          actorType: "cli",
        });
        expect(returned).toMatchObject({ status: "curating", version: 3 });
      } finally {
        await fixture.unitOfWork.close();
      }
    },
  );

  test("Done rejects create and reopen", async () => {
    const fixture = await setup("done");
    try {
      await expect(
        fixture.questions.create({
          taskId: fixture.task.id,
          expectedVersion: 1,
          text: "Forbidden",
          type: "text",
          options: [],
          allowOther: false,
          actorType: "cli",
        }),
      ).rejects.toBeInstanceOf(InvalidTransitionError);

      const questionId = fixture.ids.questionId();
      await fixture.unitOfWork.execute((stores) =>
        stores.questions.insert({
          id: questionId,
          taskId: fixture.task.id,
          cycleId: fixture.task.currentCycleId,
          text: "Old",
          type: "text",
          options: [],
          allowOther: false,
          answerText: "Answered",
          selectedOptionIds: [],
          status: "answered",
          createdAt: fixture.task.createdAt,
          updatedAt: fixture.task.updatedAt,
          answeredAt: fixture.task.updatedAt,
          dismissedAt: null,
        }),
      );
      await expect(
        fixture.questions.reopen({
          taskId: fixture.task.id,
          questionId,
          expectedVersion: 1,
          actorType: "cli",
        }),
      ).rejects.toBeInstanceOf(InvalidTransitionError);
    } finally {
      await fixture.unitOfWork.close();
    }
  });

  test("two creates with the same version produce one winner and no partial loser", async () => {
    const fixture = await setup();
    try {
      const input = {
        taskId: fixture.task.id,
        expectedVersion: 1,
        text: "Concurrent",
        type: "text" as const,
        options: [],
        allowOther: false,
        actorType: "cli" as const,
      };
      const results = await Promise.allSettled([
        fixture.questions.create(input),
        fixture.questions.create(input),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find(
        (result) => result.status === "rejected",
      ) as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(VersionConflictError);
      const stored = await fixture.unitOfWork.execute(async (stores) => ({
        task: await stores.tasks.getById(fixture.task.id),
        questions: await stores.questions.listByTaskId(fixture.task.id),
        events: (await stores.events.list({ taskId: fixture.task.id, limit: 50 })).items,
      }));
      expect(stored.task?.version).toBe(2);
      expect(stored.questions).toHaveLength(1);
      expect(stored.events).toHaveLength(2);
    } finally {
      await fixture.unitOfWork.close();
    }
  });
});
