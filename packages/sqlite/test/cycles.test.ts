import { afterEach, describe, expect, test } from "bun:test";
import {
  InvalidTransitionError,
  MessageUseCases,
  ProjectUseCases,
  QuestionUseCases,
  SystemClock,
  TaskUseCases,
  UlidIdGenerator,
} from "@aiws/core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileAttachmentBlobStore, openDatabase, SqliteUnitOfWork } from "../src/index.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("v0.4 Task cycles", () => {
  test("creates one concurrent winning Cycle and keeps context separate from Question answers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aiws-cycles-"));
    directories.push(directory);
    const unit = new SqliteUnitOfWork(openDatabase({ path: join(directory, "aiws.sqlite") }));
    const clock = new SystemClock();
    const ids = new UlidIdGenerator(clock);
    const projects = new ProjectUseCases(unit, { clock, ids });
    const tasks = new TaskUseCases(unit, { clock, ids });
    const questions = new QuestionUseCases(unit, { clock, ids });
    const blobs = await FileAttachmentBlobStore.create(directory);
    const messages = new MessageUseCases(
      unit,
      blobs,
      { clock, ids },
      { maximumAttachmentsPerTask: 10, maximumAttachmentBytes: 1024 },
    );
    const project = await projects.create({
      name: "Cycles",
      repositoryPath: "/tmp/cycles",
      gitProvider: "other",
      accountScope: "personal",
    });
    let task = await tasks.create({
      projectId: project.id,
      userRequest: "Initial request",
      actorType: "cli",
    });
    task = await tasks.transition({
      taskId: task.id,
      expectedVersion: task.version,
      from: "draft",
      to: "curating",
      actorType: "cli",
    });
    task = await tasks.update({
      taskId: task.id,
      expectedVersion: task.version,
      changes: { curatorSpec: "# Spec" },
      actorType: "cli",
    });
    task = await tasks.transition({
      taskId: task.id,
      expectedVersion: task.version,
      from: "curating",
      to: "ready",
      actorType: "cli",
    });
    task = await tasks.transition({
      taskId: task.id,
      expectedVersion: task.version,
      from: "ready",
      to: "implementing",
      actorType: "cli",
    });
    expect(
      await unit.stores.tasks.updateIfVersion(
        { ...task, automationPaused: true, version: task.version + 1 },
        task.version,
      ),
    ).toBe(true);
    task = await tasks.get(task.id);
    task = await tasks.transition({
      taskId: task.id,
      expectedVersion: task.version,
      from: "implementing",
      to: "done",
      actorType: "cli",
    });
    const input = {
      taskId: task.id,
      expectedVersion: task.version,
      text: "Incremental change",
      attachments: [],
      actorType: "cli" as const,
    };
    const concurrent = await Promise.allSettled([messages.create(input), messages.create(input)]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    task = await tasks.get(task.id);
    expect(task).toMatchObject({
      status: "curating",
      automationPaused: false,
      version: input.expectedVersion + 1,
      currentCycle: { number: 2 },
    });
    expect(await unit.stores.cycles.listByTaskId(task.id)).toHaveLength(2);
    task = await questions.create({
      taskId: task.id,
      expectedVersion: task.version,
      text: "Which behavior?",
      type: "text",
      options: [],
      allowOther: false,
      actorType: "cli",
    });
    const question = task.questions.at(-1);
    if (question === undefined) throw new Error("Question missing");
    await messages.create({
      taskId: task.id,
      expectedVersion: task.version,
      text: "Additional context",
      attachments: [],
      actorType: "cli",
    });
    task = await tasks.get(task.id);
    expect(task.status).toBe("blocked");
    expect(task.questions.find((item) => item.id === question.id)?.status).toBe("open");
    task = await questions.answer({
      taskId: task.id,
      questionId: question.id,
      expectedVersion: task.version,
      selectedOptionIds: [],
      answerText: "First answer",
      actorType: "cli",
    });
    task = await questions.reopen({
      taskId: task.id,
      questionId: question.id,
      expectedVersion: task.version,
      actorType: "cli",
    });
    task = await questions.answer({
      taskId: task.id,
      questionId: question.id,
      expectedVersion: task.version,
      selectedOptionIds: [],
      answerText: "Revised answer",
      actorType: "cli",
    });
    expect(await unit.stores.questionAnswers.listByQuestionId(question.id)).toHaveLength(2);
    task = await tasks.transition({
      taskId: task.id,
      expectedVersion: task.version,
      from: "curating",
      to: "ready",
      actorType: "cli",
    });
    task = await tasks.transition({
      taskId: task.id,
      expectedVersion: task.version,
      from: "ready",
      to: "implementing",
      actorType: "cli",
    });
    task = await tasks.transition({
      taskId: task.id,
      expectedVersion: task.version,
      from: "implementing",
      to: "done",
      actorType: "cli",
    });
    await messages.create({
      taskId: task.id,
      expectedVersion: task.version,
      text: "Third cycle",
      attachments: [],
      actorType: "cli",
    });
    task = await tasks.get(task.id);
    await expect(
      questions.reopen({
        taskId: task.id,
        questionId: question.id,
        expectedVersion: task.version,
        actorType: "cli",
      }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
    await unit.close();
  });
});
