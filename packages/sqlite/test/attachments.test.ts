import { afterEach, describe, expect, test } from "bun:test";
import {
  AttachmentLimitReachedError,
  AttachmentTooLargeError,
  AttachmentUseCases,
  createProject,
  createTask,
  type Stores,
  StorageError,
  SystemClock,
  type UnitOfWork,
  UlidIdGenerator,
  UnsupportedMediaTypeError,
  VersionConflictError,
} from "@aiws/core";
import { mkdir, mkdtemp, readdir, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileAttachmentBlobStore, openDatabase, SqliteUnitOfWork } from "../src/index.ts";

const temporaryDirectories: string[] = [];
const encoder = new TextEncoder();

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Attachment file storage", () => {
  test("accepts every allowed extension, normalizes MIME and calculates SHA-256", async () => {
    const { store } = await storageFixture();
    const samples: [string, string, Uint8Array][] = [
      ["image.png", "image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
      ["image.jpg", "image/jpeg", bytes(0xff, 0xd8, 0xff, 0xdb)],
      ["image.jpeg", "image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)],
      ["image.webp", "image/webp", encoder.encode("RIFF0000WEBP")],
      ["image.gif", "image/gif", encoder.encode("GIF89a")],
      ["file.pdf", "application/pdf", encoder.encode("%PDF-1.7")],
      ["file.txt", "text/plain", encoder.encode("hello")],
      ["file.log", "text/plain", encoder.encode("hello")],
      ["file.md", "text/markdown", encoder.encode("# hello")],
      ["file.markdown", "text/markdown", encoder.encode("# hello")],
      ["file.json", "application/json", encoder.encode("opaque json")],
      ["file.jsonl", "application/json", encoder.encode("opaque jsonl")],
      ["file.csv", "text/csv", encoder.encode("a,b")],
      ["file.tsv", "text/tab-separated-values", encoder.encode("a\tb")],
      ["file.xml", "application/xml", encoder.encode("opaque xml")],
      ["file.yaml", "application/yaml", encoder.encode("opaque yaml")],
      ["file.yml", "application/yaml", encoder.encode("opaque yaml")],
    ];

    for (const [name, mimeType, content] of samples) {
      const staged = await store.stage(stream(content, 2), {
        maximumBytes: 1024,
        originalName: name,
        declaredMimeType: mimeType,
      });
      expect(staged).toMatchObject({ originalName: name, mimeType, sizeBytes: content.byteLength });
      expect(staged.sha256).toBe(new Bun.CryptoHasher("sha256").update(content).digest("hex"));
      await store.discard(staged);
    }
  });

  test("rejects invalid magic, unsafe text, forbidden types, empty files and streaming overflow", async () => {
    const { store } = await storageFixture();
    const cases: [string, string, Uint8Array][] = [
      ["fake.png", "image/png", encoder.encode("not png")],
      ["nul.txt", "text/plain", bytes(0x61, 0, 0x62)],
      ["invalid.txt", "text/plain", bytes(0xc3, 0x28)],
      ["page.html", "text/html", encoder.encode("<p>x</p>")],
      ["vector.svg", "image/svg+xml", encoder.encode("<svg/>")],
      ["archive.zip", "application/zip", bytes(0x50, 0x4b, 3, 4)],
      ["empty.txt", "text/plain", new Uint8Array()],
    ];
    for (const [name, mimeType, content] of cases) {
      await expect(
        store.stage(stream(content, 1), {
          maximumBytes: 1024,
          originalName: name,
          declaredMimeType: mimeType,
        }),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeError);
    }
    await expect(
      store.stage(stream(encoder.encode("12345"), 1), {
        maximumBytes: 4,
        originalName: "large.txt",
        declaredMimeType: "text/plain",
      }),
    ).rejects.toBeInstanceOf(AttachmentTooLargeError);
  });

  test("processes a multi-megabyte upload as bounded chunks", async () => {
    const { store } = await storageFixture();
    const chunk = new Uint8Array(64 * 1024).fill(0x61);
    const chunkCount = 64;
    let emitted = 0;
    const input = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted === chunkCount) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
        emitted += 1;
      },
    });
    const staged = await store.stage(input, {
      maximumBytes: chunk.byteLength * chunkCount,
      originalName: "large.log",
      declaredMimeType: "text/plain",
    });
    expect(staged.sizeBytes).toBe(chunk.byteLength * chunkCount);
    expect(emitted).toBe(chunkCount);
    await store.discard(staged);
  });

  test("streams identical committed bytes, prevents traversal and cleans only old orphans", async () => {
    const { directory, store } = await storageFixture();
    const content = encoder.encode("chunked content");
    const staged = await store.stage(stream(content, 2), {
      maximumBytes: 1024,
      originalName: "../../safe.log",
      declaredMimeType: "application/octet-stream",
    });
    const storageKey = "attachments/tsk_00000000000000000000000000/att_00000000000000000000000000";
    await store.commit(staged, storageKey);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, storageKey))).mode & 0o777).toBe(0o600);
    expect(new Uint8Array(await new Response(await store.open(storageKey)).arrayBuffer())).toEqual(
      content,
    );
    await expect(store.open("attachments/../escape")).rejects.toBeInstanceOf(StorageError);

    const recent = await store.stage(stream(encoder.encode("recent")), {
      maximumBytes: 1024,
      originalName: "recent.txt",
      declaredMimeType: "text/plain",
    });
    const old = await store.stage(stream(encoder.encode("old")), {
      maximumBytes: 1024,
      originalName: "old.txt",
      declaredMimeType: "text/plain",
    });
    await utimes(
      join(directory, "tmp", "uploads", old.token),
      new Date("2020-01-01T00:00:00.000Z"),
      new Date("2020-01-01T00:00:00.000Z"),
    );
    await store.cleanupOrphans(new Date("2021-01-01T00:00:00.000Z"), () => false);
    expect(await readdir(join(directory, "tmp", "uploads"))).toEqual([recent.token]);

    const referencedKey =
      "attachments/tsk_00000000000000000000000001/att_00000000000000000000000001";
    const referenced = await store.stage(stream(encoder.encode("referenced")), {
      maximumBytes: 1024,
      originalName: "referenced.txt",
      declaredMimeType: "text/plain",
    });
    await store.commit(referenced, referencedKey);
    const referencedQuarantine = await store.quarantine(referencedKey);
    const orphanKey = "attachments/tsk_00000000000000000000000002/att_00000000000000000000000002";
    const orphan = await store.stage(stream(encoder.encode("orphan")), {
      maximumBytes: 1024,
      originalName: "orphan.txt",
      declaredMimeType: "text/plain",
    });
    await store.commit(orphan, orphanKey);
    const orphanQuarantine = await store.quarantine(orphanKey);
    const recentKey = "attachments/tsk_00000000000000000000000003/att_00000000000000000000000003";
    const recentBlob = await store.stage(stream(encoder.encode("recent quarantine")), {
      maximumBytes: 1024,
      originalName: "recent-quarantine.txt",
      declaredMimeType: "text/plain",
    });
    await store.commit(recentBlob, recentKey);
    const recentQuarantine = await store.quarantine(recentKey);
    for (const token of [referencedQuarantine.token, orphanQuarantine.token]) {
      await utimes(
        join(directory, "tmp", "quarantine", token),
        new Date("2020-01-01T00:00:00.000Z"),
        new Date("2020-01-01T00:00:00.000Z"),
      );
    }
    await store.cleanupOrphans(
      new Date("2021-01-01T00:00:00.000Z"),
      (key) => key === referencedKey,
    );
    expect(await new Response(await store.open(referencedKey)).text()).toBe("referenced");
    await expect(store.open(orphanKey)).rejects.toBeInstanceOf(StorageError);
    expect(await readdir(join(directory, "tmp", "quarantine"))).toEqual([recentQuarantine.token]);
  });
});

describe("Attachment SQLite workflow", () => {
  test("adds, downloads and removes metadata/blob/event with one version increment", async () => {
    const fixture = await workflowFixture();
    try {
      const content = encoder.encode("a streamed log\n");
      const added = await fixture.attachments.add({
        taskId: fixture.task.id,
        expectedVersion: 1,
        originalName: "../../run.log",
        declaredMimeType: "text/plain",
        content: stream(content, 1),
        actorType: "cli",
      });
      expect(added).toMatchObject({
        taskVersion: 2,
        attachment: { originalName: "run.log", mimeType: "text/plain", sizeBytes: content.length },
      });
      const opened = await fixture.attachments.openContent(fixture.task.id, added.attachment.id);
      expect(new Uint8Array(await new Response(opened.content).arrayBuffer())).toEqual(content);
      const row = fixture.database
        .query<{ storage_key: string }, [string]>(
          "SELECT storage_key FROM attachments WHERE id = ?",
        )
        .get(added.attachment.id);
      expect(row?.storage_key).not.toContain("run.log");
      const events = await fixture.unitOfWork.execute((stores) =>
        stores.events.list({ taskId: fixture.task.id, limit: 50 }),
      );
      expect(events.items.at(0)).toMatchObject({
        type: "attachment_added",
        metadata: { taskVersion: 2, originalName: "run.log", sizeBytes: content.length },
      });

      expect(
        await fixture.attachments.remove({
          taskId: fixture.task.id,
          attachmentId: added.attachment.id,
          expectedVersion: 2,
          actorType: "web",
        }),
      ).toEqual({ taskVersion: 3 });
      expect(await fixture.attachments.list(fixture.task.id)).toEqual([]);
      expect(
        (await fixture.unitOfWork.execute((stores) => stores.tasks.getById(fixture.task.id)))
          ?.version,
      ).toBe(3);
      await expect(fixture.store.open(row?.storage_key ?? "")).rejects.toBeInstanceOf(StorageError);
    } finally {
      await fixture.unitOfWork.close();
    }
  });

  test("cleans staged/final blobs on conflicts and database failure", async () => {
    const fixture = await workflowFixture();
    try {
      await expect(
        fixture.attachments.add({
          taskId: fixture.task.id,
          expectedVersion: 2,
          originalName: "conflict.txt",
          declaredMimeType: "text/plain",
          content: stream(encoder.encode("loser")),
          actorType: "cli",
        }),
      ).rejects.toBeInstanceOf(VersionConflictError);
      expect(await readdir(join(fixture.directory, "tmp", "uploads"))).toEqual([]);

      fixture.failing.failEvents = true;
      await expect(
        fixture.attachments.add({
          taskId: fixture.task.id,
          expectedVersion: 1,
          originalName: "db-fail.txt",
          declaredMimeType: "text/plain",
          content: stream(encoder.encode("rollback")),
          actorType: "cli",
        }),
      ).rejects.toThrow("simulated event failure");
      expect(fixture.database.query("SELECT * FROM attachments").all()).toEqual([]);
      expect(await recursiveFiles(join(fixture.directory, "attachments"))).toEqual([]);
    } finally {
      await fixture.unitOfWork.close();
    }
  });

  test("restores quarantined blob when delete transaction fails and enforces the count limit", async () => {
    const fixture = await workflowFixture(10);
    try {
      let first: Awaited<ReturnType<typeof fixture.attachments.add>> | undefined;
      for (let index = 1; index <= 10; index += 1) {
        const added = await fixture.attachments.add({
          taskId: fixture.task.id,
          expectedVersion: index,
          originalName: `${index}.txt`,
          declaredMimeType: "text/plain",
          content: stream(encoder.encode(String(index))),
          actorType: "cli",
        });
        if (index === 1) first = added;
      }
      if (first === undefined) throw new Error("Test setup did not create an attachment.");
      await expect(
        fixture.attachments.add({
          taskId: fixture.task.id,
          expectedVersion: 11,
          originalName: "eleven.txt",
          declaredMimeType: "text/plain",
          content: stream(encoder.encode("eleven")),
          actorType: "cli",
        }),
      ).rejects.toBeInstanceOf(AttachmentLimitReachedError);

      fixture.failing.failEvents = true;
      await expect(
        fixture.attachments.remove({
          taskId: fixture.task.id,
          attachmentId: first.attachment.id,
          expectedVersion: 11,
          actorType: "cli",
        }),
      ).rejects.toThrow("simulated event failure");
      expect(await fixture.attachments.get(fixture.task.id, first.attachment.id)).toEqual(
        first.attachment,
      );
      const opened = await fixture.attachments.openContent(fixture.task.id, first.attachment.id);
      expect(await new Response(opened.content).text()).toBe("1");
    } finally {
      await fixture.unitOfWork.close();
    }
  });
});

class FailingUnitOfWork implements UnitOfWork {
  failEvents = false;
  constructor(private readonly delegate: SqliteUnitOfWork) {}

  execute<T>(work: (stores: Stores) => Promise<T>): Promise<T> {
    return this.delegate.execute((stores) =>
      work({
        ...stores,
        events: {
          ...stores.events,
          append: async (events) => {
            if (this.failEvents) throw new Error("simulated event failure");
            await stores.events.append(events);
          },
          list: (query) => stores.events.list(query),
        },
      }),
    );
  }
}

async function storageFixture() {
  const directory = await mkdtemp(join(tmpdir(), "aiws-attachments-storage-"));
  temporaryDirectories.push(directory);
  return { directory, store: await FileAttachmentBlobStore.create(directory) };
}

async function workflowFixture(maximumAttachmentsPerTask = 10) {
  const { directory, store } = await storageFixture();
  const database = openDatabase({ path: join(directory, "aiws.sqlite") });
  const unitOfWork = new SqliteUnitOfWork(database);
  const failing = new FailingUnitOfWork(unitOfWork);
  const clock = new SystemClock();
  const ids = new UlidIdGenerator(clock);
  const project = createProject({
    id: ids.projectId(),
    name: "AIWS",
    repositoryPath: "/repos/aiws",
    gitProvider: "github",
    accountScope: "personal",
    now: clock.now().toISOString(),
  });
  const task = createTask({
    id: ids.taskId(),
    projectId: project.id,
    userRequest: "Attachment workflow",
    now: clock.now().toISOString(),
  });
  await unitOfWork.execute(async (stores) => {
    await stores.projects.insert(project);
    await stores.tasks.insert(task);
  });
  return {
    directory,
    database,
    unitOfWork,
    failing,
    store,
    task,
    attachments: new AttachmentUseCases(
      failing,
      store,
      { clock, ids },
      { maximumAttachmentsPerTask, maximumAttachmentBytes: 1024 },
    ),
  };
}

function stream(value: Uint8Array, chunkSize = value.byteLength || 1): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= value.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(value.subarray(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

async function recursiveFiles(directory: string): Promise<string[]> {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}
