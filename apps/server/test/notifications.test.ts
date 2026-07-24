import { afterEach, describe, expect, test } from "bun:test";
import { openDatabase, SqliteUnitOfWork } from "@aiws/sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NotificationDispatcher,
  NotificationSettingsService,
  NtfyPublisher,
} from "../src/notifications.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture(fetcher: typeof fetch = fetch, key = Buffer.alloc(32, 7)) {
  const directory = mkdtempSync(join(tmpdir(), "aiws-notifications-"));
  directories.push(directory);
  const database = openDatabase({ path: join(directory, "aiws.sqlite") });
  seedTask(database);
  const publisher = new NtfyPublisher(fetcher);
  const settings = new NotificationSettingsService(database, key, publisher);
  return { database, unitOfWork: new SqliteUnitOfWork(database), publisher, settings, key };
}

describe("global ntfy notifications", () => {
  test("starts disabled and enqueues status events only after activation in the same transaction", async () => {
    const item = fixture();
    expect(item.settings.get()).toMatchObject({
      enabled: false,
      baseUrl: "https://ntfy.sh",
      topic: "",
      accessTokenConfigured: false,
    });

    await appendStatus(item.unitOfWork, "evt_00000000000000000000000001");
    expect(outboxCount(item.database)).toBe(0);

    await item.settings.update({ enabled: true, topic: "aiws_test" }, new Date(NOW));
    await appendStatus(item.unitOfWork, "evt_00000000000000000000000002");
    expect(
      item.database
        .query<
          {
            event_id: string;
            project_name: string;
            task_title: string;
            from_status: string;
            to_status: string;
          },
          []
        >(
          "SELECT event_id, project_name, task_title, from_status, to_status FROM notification_outbox",
        )
        .get(),
    ).toEqual({
      event_id: "evt_00000000000000000000000002",
      project_name: "Project snapshot",
      task_title: "Task snapshot",
      from_status: "draft",
      to_status: "curating",
    });

    await expect(
      item.unitOfWork.execute(async (stores) => {
        await stores.events.append([statusEvent("evt_00000000000000000000000003")]);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(outboxCount(item.database)).toBe(1);
    await item.unitOfWork.close();
  });

  test("encrypts tokens, never returns them, and fails safely with a missing or wrong key", async () => {
    const item = fixture();
    const updated = await item.settings.update({
      topic: "private_topic",
      accessToken: "secret-bearer-token",
    });
    expect(updated.accessTokenConfigured).toBeTrue();
    expect(JSON.stringify(updated)).not.toContain("secret-bearer-token");
    const row = item.database
      .query<{ token_ciphertext: Uint8Array; token_iv: Uint8Array }, []>(
        "SELECT token_ciphertext, token_iv FROM notification_settings",
      )
      .get();
    expect(Buffer.from(row?.token_ciphertext ?? []).toString("utf8")).not.toContain(
      "secret-bearer-token",
    );
    expect(() => new NotificationSettingsService(item.database, undefined, item.publisher)).toThrow(
      "AIWS_NOTIFICATION_ENCRYPTION_KEY",
    );
    expect(
      () => new NotificationSettingsService(item.database, Buffer.alloc(32, 8), item.publisher),
    ).toThrow("AIWS_NOTIFICATION_ENCRYPTION_KEY");
    expect(
      (await item.settings.update({ topic: "renamed_topic" })).accessTokenConfigured,
    ).toBeTrue();
    expect((await item.settings.update({ accessToken: null })).accessTokenConfigured).toBeFalse();
    item.database.close();
  });

  test("sanitizes timeout and network failures without including credentials or response bodies", async () => {
    const timeout = new NtfyPublisher((async () => {
      throw new DOMException("secret-token", "TimeoutError");
    }) as unknown as typeof fetch);
    await expect(
      timeout.publish({
        baseUrl: "https://ntfy.example.com",
        topic: "topic",
        token: "secret-token",
        title: "title",
        message: "message",
        sequenceId: "evt_1",
      }),
    ).rejects.toThrow("timed out");

    const network = new NtfyPublisher((async () => {
      throw new Error("response body with secret-token");
    }) as unknown as typeof fetch);
    let error: unknown;
    try {
      await network.publish({
        baseUrl: "https://ntfy.example.com",
        topic: "topic",
        token: "secret-token",
        title: "title",
        message: "message",
        sequenceId: "evt_1",
      });
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).toContain("ntfy request failed");
    expect(String(error)).not.toContain("secret-token");
    expect(String(error)).not.toContain("response body");
  });

  test("publishes the exact payload, Bearer auth and event idempotency key, then deletes the row", async () => {
    const requests: Request[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const item = fixture(fetcher);
    await item.settings.update({
      enabled: true,
      baseUrl: "https://ntfy.example.com",
      topic: "private_topic",
      accessToken: "secret-token",
    });
    await appendStatus(item.unitOfWork, "evt_00000000000000000000000004");
    const dispatcher = new NotificationDispatcher(
      item.database,
      item.settings,
      item.publisher,
      "https://aiws.example.com",
      () => new Date(NOW),
    );
    await dispatcher.poll();

    expect(outboxCount(item.database)).toBe(0);
    expect(requests).toHaveLength(1);
    const request = requests[0] as Request;
    expect(request.url).toBe("https://ntfy.example.com/");
    expect(request.redirect).toBe("manual");
    expect(request.headers.get("Authorization")).toBe("Bearer secret-token");
    expect(await request.json()).toEqual({
      topic: "private_topic",
      title: "AIWS · Project snapshot",
      message:
        "Task snapshot\ndraft → curating\nTask: tsk_00000000000000000000000001\nProject: prj_00000000000000000000000001",
      click: "https://aiws.example.com/tasks/tsk_00000000000000000000000001",
      priority: 3,
      sequence_id: "evt_00000000000000000000000004",
    });
    await item.unitOfWork.close();
  });

  test("retries failures after exponential backoff and configuration changes cancel pending rows", async () => {
    const fetcher = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    const item = fixture(fetcher);
    await item.settings.update({ enabled: true, topic: "retry_topic" }, new Date(NOW));
    await appendStatus(item.unitOfWork, "evt_00000000000000000000000005");
    const dispatcher = new NotificationDispatcher(
      item.database,
      item.settings,
      item.publisher,
      "https://aiws.example.com",
      () => new Date(NOW),
    );
    await dispatcher.poll();
    expect(
      item.database
        .query<{ attempt_count: number; next_attempt_at: string; last_error: string }, []>(
          "SELECT attempt_count, next_attempt_at, last_error FROM notification_outbox",
        )
        .get(),
    ).toEqual({
      attempt_count: 1,
      next_attempt_at: "2026-07-24T10:00:05.000Z",
      last_error: "ntfy returned HTTP 503.",
    });

    await item.settings.update({ topic: "new_topic" });
    expect(outboxCount(item.database)).toBe(0);
    await item.unitOfWork.close();
  });

  test("rejects unsafe URLs, invalid topics and tokens over HTTP", async () => {
    const item = fixture();
    await expect(item.settings.update({ enabled: true, topic: "" })).rejects.toThrow("validation");
    await expect(item.settings.update({ baseUrl: "https://user@example.com" })).rejects.toThrow(
      "validation",
    );
    await expect(
      item.settings.update({
        baseUrl: "http://ntfy.example.com",
        accessToken: "secret",
      }),
    ).rejects.toThrow("validation");
    item.database.close();
  });
});

const NOW = "2026-07-24T10:00:00.000Z";

function seedTask(database: ReturnType<typeof openDatabase>): void {
  database
    .query(
      `INSERT INTO projects(
         id, name, description, repository_path, git_provider, account_scope, created_at, updated_at
       ) VALUES (?, ?, '', ?, 'github', 'personal', ?, ?)`,
    )
    .run("prj_00000000000000000000000001", "Project snapshot", "/repos/project", NOW, NOW);
  database
    .query(
      `INSERT INTO tasks(
         id, project_id, title, user_request, curator_spec, status, version, created_at, updated_at
       ) VALUES (?, ?, ?, 'Request', '', 'draft', 1, ?, ?)`,
    )
    .run(
      "tsk_00000000000000000000000001",
      "prj_00000000000000000000000001",
      "Task snapshot",
      NOW,
      NOW,
    );
}

function statusEvent(id: string) {
  return {
    id: id as never,
    taskId: "tsk_00000000000000000000000001" as never,
    type: "status_changed" as const,
    actorType: "web" as const,
    metadata: {
      taskVersion: 2,
      from: "draft",
      to: "curating",
      automatic: false,
    },
    createdAt: NOW,
  };
}

async function appendStatus(unitOfWork: SqliteUnitOfWork, id: string): Promise<void> {
  await unitOfWork.execute(async (stores) => {
    await stores.events.append([statusEvent(id)]);
  });
}

function outboxCount(database: ReturnType<typeof openDatabase>): number {
  return (
    database.query<{ count: number }, []>("SELECT count(*) AS count FROM notification_outbox").get()
      ?.count ?? 0
  );
}
