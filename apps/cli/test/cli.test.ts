import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../src/config.ts";
import type { CliIo } from "../src/io.ts";
import { createProgram, runCli } from "../src/program.ts";

function harness(options: { stdin?: string; confirm?: boolean } = {}) {
  let stdout = "";
  let stderr = "";
  const bytes: number[] = [];
  const io: CliIo = {
    stdout: (value) => {
      stdout += value;
    },
    stdoutBytes: (value) => {
      bytes.push(...value);
    },
    stderr: (value) => {
      stderr += value;
    },
    readStdin: async () => options.stdin ?? "",
    confirm: async () => options.confirm ?? false,
  };
  return { io, stdout: () => stdout, stderr: () => stderr, bytes: () => bytes };
}

const argv = (...values: string[]) => ["bun", "aiws", ...values];
const ok = (value: unknown, status = 200) => Response.json(value, { status });
const error = (status: number, code: string) =>
  ok({ error: { code, message: `${code} message`, details: {}, requestId: "req_test" } }, status);

describe("CLI global behavior", () => {
  test("registers the complete documented command tree", () => {
    const program = createProgram({ io: harness().io, environment: {} });
    const project = program.commands.find((command) => command.name() === "project");
    const task = program.commands.find((command) => command.name() === "task");
    const question = task?.commands.find((command) => command.name() === "question");
    const attachment = task?.commands.find((command) => command.name() === "attachment");
    const profile = program.commands.find((command) => command.name() === "agent-profile");
    const runner = program.commands.find((command) => command.name() === "runner");
    const config = program.commands.find((command) => command.name() === "config");
    expect(config?.commands.map((command) => command.name())).toEqual([
      "path",
      "show",
      "set",
      "unset",
    ]);
    expect(project?.commands.map((command) => command.name())).toEqual([
      "create",
      "list",
      "show",
      "branches",
      "update",
      "archive",
      "unarchive",
    ]);
    expect(task?.commands.map((command) => command.name())).toEqual([
      "create",
      "list",
      "show",
      "update",
      "transition",
      "automation-resume",
      "archive",
      "unarchive",
      "question",
      "attachment",
      "message",
      "timeline",
      "activity",
    ]);
    expect(question?.commands.map((command) => command.name())).toEqual([
      "create",
      "list",
      "show",
      "update",
      "answer",
      "dismiss",
      "reopen",
    ]);
    expect(attachment?.commands.map((command) => command.name())).toEqual([
      "add",
      "list",
      "get",
      "delete",
    ]);
    expect(profile?.commands.map((command) => command.name())).toEqual([
      "list",
      "models",
      "create",
      "enable",
      "disable",
    ]);
    expect(runner?.commands.map((command) => command.name())).toEqual(["status"]);
    const createProfile = profile?.commands.find((command) => command.name() === "create");
    expect(createProfile?.options.find((option) => option.long === "--model")?.mandatory).toBe(
      true,
    );
    expect(
      createProfile?.options.find((option) => option.long === "--reasoning-effort")?.mandatory,
    ).toBe(true);
  });

  test("help and version need neither configuration nor network", async () => {
    for (const flag of ["--help", "--version"]) {
      const output = harness();
      expect(await runCli(argv(flag), { io: output.io, environment: {} })).toBe(0);
      expect(output.stderr()).toBe("");
      expect(output.stdout().length).toBeGreaterThan(0);
    }
  });

  test("config uses flags over environment over defaults", () => {
    const paths = {
      user: "/tmp/aiws-cli-test-missing-user-config",
      system: "/tmp/aiws-cli-test-missing-system-config",
    };
    expect(
      resolveConfig(
        { apiUrl: "http://flag", token: "flag-token", json: true },
        { AIWS_API_URL: "http://env", AIWS_API_TOKEN: "env-token" },
        paths,
      ),
    ).toMatchObject({ apiUrl: "http://flag", token: "flag-token", json: true });
    expect(resolveConfig({}, { AIWS_API_TOKEN: "env-token" }, paths).apiUrl).toBe(
      "http://127.0.0.1:3000",
    );
  });

  test("persistent config follows documented precedence and never reveals its token", async () => {
    const root = await mkdtemp(join(tmpdir(), "aiws-cli-config-"));
    const paths = {
      user: join(root, "user", "config.json"),
      system: join(root, "system", "config.json"),
    };
    const explicit = join(root, "explicit.json");
    try {
      await mkdir(join(root, "user"), { recursive: true });
      await mkdir(join(root, "system"), { recursive: true });
      await writeFile(
        paths.system,
        JSON.stringify({ apiUrl: "http://system", token: "system-token" }),
      );
      await writeFile(paths.user, JSON.stringify({ apiUrl: "http://user", token: "user-token" }));
      await writeFile(explicit, JSON.stringify({ apiUrl: "http://explicit", token: "file-token" }));

      expect(resolveConfig({}, { AIWS_CONFIG_FILE: explicit }, paths)).toMatchObject({
        apiUrl: "http://explicit",
        token: "file-token",
      });
      expect(
        resolveConfig(
          {},
          {
            AIWS_CONFIG_FILE: explicit,
            AIWS_API_URL: "http://environment",
            AIWS_API_TOKEN: "env-token",
          },
          paths,
        ),
      ).toMatchObject({ apiUrl: "http://environment", token: "env-token" });

      const output = harness();
      expect(
        await runCli(argv("--json", "config", "show"), {
          io: output.io,
          environment: { AIWS_CONFIG_FILE: explicit },
          configPaths: paths,
        }),
      ).toBe(0);
      expect(JSON.parse(output.stdout())).toEqual({
        apiUrl: "http://explicit",
        token: "[REDACTED]",
      });
      expect(output.stdout()).not.toContain("file-token");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("config set writes atomically with private permissions and unset preserves other fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "aiws-cli-config-write-"));
    const paths = {
      user: join(root, "user", "aiws", "config.json"),
      system: join(root, "system", "config.json"),
    };
    try {
      const setOutput = harness({ stdin: "stored-secret\n" });
      expect(
        await runCli(
          argv("--json", "config", "set", "--url", "http://127.0.0.1:4000", "--token-stdin"),
          {
            io: setOutput.io,
            environment: {},
            configPaths: paths,
          },
        ),
      ).toBe(0);
      expect(setOutput.stdout()).not.toContain("stored-secret");
      expect(JSON.parse(await readFile(paths.user, "utf8"))).toEqual({
        apiUrl: "http://127.0.0.1:4000",
        token: "stored-secret",
      });
      expect((await stat(paths.user)).mode & 0o777).toBe(0o600);
      expect((await stat(join(root, "user", "aiws"))).mode & 0o777).toBe(0o700);

      const unsetOutput = harness();
      expect(
        await runCli(argv("--json", "config", "unset", "--credential"), {
          io: unsetOutput.io,
          environment: {},
          configPaths: paths,
        }),
      ).toBe(0);
      expect(JSON.parse(await readFile(paths.user, "utf8"))).toEqual({
        apiUrl: "http://127.0.0.1:4000",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("missing token exits 3", async () => {
    const output = harness();
    expect(
      await runCli(argv("--json", "project", "list"), { io: output.io, environment: {} }),
    ).toBe(3);
    expect(JSON.parse(output.stderr()).error.code).toBe("configuration_error");
  });

  test("Commander usage errors remain machine-readable in JSON mode", async () => {
    const output = harness();
    expect(await runCli(argv("--json", "--unknown"), { io: output.io })).toBe(2);
    expect(JSON.parse(output.stderr()).error.code).toBe("invalid_input");
    expect(output.stderr()).not.toContain("Usage:");
  });

  test("maps API status codes and preserves the request ID", async () => {
    for (const [status, exit] of [
      [401, 3],
      [404, 4],
      [409, 5],
      [428, 5],
      [422, 2],
      [500, 6],
    ] as const) {
      const output = harness();
      const code = await runCli(argv("--json", "--token", "token", "project", "list"), {
        io: output.io,
        fetch: async () => error(status, `http_${status}`),
      });
      expect(code).toBe(exit);
      expect(JSON.parse(output.stderr()).error.requestId).toBe("req_test");
      expect(output.stdout()).toBe("");
    }
  });

  test("redacts a token from unexpected network errors", async () => {
    const output = harness();
    const code = await runCli(argv("--json", "--token", "super-secret", "project", "list"), {
      io: output.io,
      fetch: async () => {
        throw new Error("failed with super-secret");
      },
    });
    expect(code).toBe(7);
    expect(output.stderr()).not.toContain("super-secret");
    expect(output.stderr()).toContain("[REDACTED]");
  });
});

describe("CLI inputs and commands", () => {
  test("reports runner status and resumes paused automation with optimistic concurrency", async () => {
    const requests: Array<{ method: string; path: string; ifMatch: string | null }> = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        ifMatch: request.headers.get("If-Match"),
      });
      if (request.method === "GET") {
        return ok({ status: "online", lastSeenAt: "2026-07-24T08:00:00.000Z" });
      }
      return ok({ id: "tsk_1", version: 4, automationPaused: false });
    };

    const statusOutput = harness();
    expect(
      await runCli(argv("--json", "--token", "token", "runner", "status"), {
        io: statusOutput.io,
        fetch,
      }),
    ).toBe(0);
    expect(JSON.parse(statusOutput.stdout()).status).toBe("online");

    const resumeOutput = harness();
    expect(
      await runCli(
        argv(
          "--json",
          "--token",
          "token",
          "task",
          "automation-resume",
          "tsk_1",
          "--expected-version",
          "3",
        ),
        { io: resumeOutput.io, fetch },
      ),
    ).toBe(0);
    expect(requests).toEqual([
      { method: "GET", path: "/api/v1/system/runner", ifMatch: null },
      {
        method: "POST",
        path: "/api/v1/tasks/tsk_1/automation/resume",
        ifMatch: '"3"',
      },
    ]);
  });

  test("lists models and requires model/effort when creating a profile", async () => {
    const output = harness();
    let body: unknown;
    const code = await runCli(
      argv(
        "--json",
        "--token",
        "token",
        "agent-profile",
        "models",
        "--auth-mode",
        "api_key",
        "--credential-reference",
        "OPENAI_API_KEY",
      ),
      {
        io: output.io,
        fetch: async (input) => {
          body = await new Request(input).json();
          return ok({ models: [] });
        },
      },
    );
    expect(code).toBe(0);
    expect(body).toEqual({
      authMode: "api_key",
      credentialReference: "OPENAI_API_KEY",
    });
  });

  test("reads stdin, normalizes CRLF and emits compact API JSON only", async () => {
    const output = harness({ stdin: "first\r\nsecond\r\n" });
    let body: unknown;
    const code = await runCli(
      argv(
        "--json",
        "--token",
        "token",
        "task",
        "create",
        "--project",
        "prj_01K0ABCDEFGHJKMNPQRSTVWXYZ",
        "--request-file",
        "-",
        "--base-branch",
        "release/next",
      ),
      {
        io: output.io,
        fetch: async (input) => {
          body = await new Request(input).json();
          return ok({ id: "tsk_1", version: 1 }, 201);
        },
      },
    );
    expect(code).toBe(0);
    expect(body).toMatchObject({
      userRequest: "first\nsecond\n",
      baseBranch: "release/next",
    });
    expect(output.stdout()).toBe('{"id":"tsk_1","version":1}\n');
    expect(output.stderr()).toBe("");
  });

  test("rejects mutually exclusive inline/file inputs locally", async () => {
    const output = harness();
    const code = await runCli(
      argv(
        "--json",
        "--token",
        "token",
        "task",
        "create",
        "--project",
        "prj_1",
        "--request",
        "a",
        "--request-file",
        "b",
      ),
      { io: output.io },
    );
    expect(code).toBe(2);
    expect(JSON.parse(output.stderr()).error.code).toBe("invalid_input");
  });

  test("translates question choice names and repeated options", async () => {
    const output = harness();
    let body: unknown;
    const code = await runCli(
      argv(
        "--json",
        "--token",
        "token",
        "task",
        "question",
        "create",
        "tsk_1",
        "--expected-version",
        "2",
        "--type",
        "single-choice",
        "--text",
        "Where?",
        "--option",
        "Prod",
        "--option",
        "Test",
        "--allow-other",
      ),
      {
        io: output.io,
        fetch: async (input) => {
          body = await new Request(input).json();
          return ok({ id: "tsk_1", version: 3 }, 201);
        },
      },
    );
    expect(code).toBe(0);
    expect(body).toEqual({
      text: "Where?",
      type: "single_choice",
      options: [{ label: "Prod" }, { label: "Test" }],
      allowOther: true,
    });
  });

  test("JSON attachment delete requires --yes without a request", async () => {
    const output = harness();
    let called = false;
    const code = await runCli(
      argv(
        "--json",
        "--token",
        "token",
        "task",
        "attachment",
        "delete",
        "tsk_1",
        "att_1",
        "--expected-version",
        "1",
      ),
      {
        io: output.io,
        fetch: async () => {
          called = true;
          return ok({});
        },
      },
    );
    expect(code).toBe(2);
    expect(called).toBe(false);
    expect(JSON.parse(output.stderr()).error.code).toBe("confirmation_required");
  });

  test("downloads bytes atomically and protects an existing destination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aiws-cli-"));
    const destination = join(directory, "download.bin");
    const output = harness();
    try {
      const first = await runCli(
        argv(
          "--json",
          "--token",
          "token",
          "task",
          "attachment",
          "get",
          "tsk_1",
          "att_1",
          "--output",
          destination,
        ),
        { io: output.io, fetch: async () => new Response(new Uint8Array([0, 1, 255])) },
      );
      expect(first).toBe(0);
      expect([...new Uint8Array(await readFile(destination))]).toEqual([0, 1, 255]);
      const second = await runCli(
        argv(
          "--json",
          "--token",
          "token",
          "task",
          "attachment",
          "get",
          "tsk_1",
          "att_1",
          "--output",
          destination,
        ),
        {
          io: harness().io,
          fetch: async () => {
            throw new Error("must not run");
          },
        },
      );
      expect(second).toBe(8);
      const forced = await runCli(
        argv(
          "--json",
          "--token",
          "token",
          "task",
          "attachment",
          "get",
          "tsk_1",
          "att_1",
          "--output",
          destination,
          "--force",
        ),
        { io: harness().io, fetch: async () => new Response(new Uint8Array([7, 8])) },
      );
      expect(forced).toBe(0);
      expect([...new Uint8Array(await readFile(destination))]).toEqual([7, 8]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("streams binary stdout and rejects combining it with JSON", async () => {
    const binary = harness();
    expect(
      await runCli(
        argv("--token", "token", "task", "attachment", "get", "tsk_1", "att_1", "--output", "-"),
        { io: binary.io, fetch: async () => new Response(new Uint8Array([0, 255, 1])) },
      ),
    ).toBe(0);
    expect(binary.bytes()).toEqual([0, 255, 1]);
    expect(binary.stdout()).toBe("");

    const json = harness();
    expect(
      await runCli(
        argv(
          "--json",
          "--token",
          "token",
          "task",
          "attachment",
          "get",
          "tsk_1",
          "att_1",
          "--output",
          "-",
        ),
        { io: json.io },
      ),
    ).toBe(2);
    expect(JSON.parse(json.stderr()).error.code).toBe("invalid_input");
  });

  test("renders human list output as a compact table with complete IDs", async () => {
    const output = harness();
    await runCli(argv("--token", "token", "project", "list"), {
      io: output.io,
      fetch: async () =>
        ok({ items: [{ id: "prj_COMPLETE_ID", name: "Project" }], nextCursor: null }),
    });
    expect(output.stdout()).toContain("id");
    expect(output.stdout()).toContain("prj_COMPLETE_ID");
    expect(output.stdout()).not.toContain("{");
  });

  test("reports partial Task creation when an attachment cannot be read", async () => {
    const output = harness();
    const code = await runCli(
      argv(
        "--json",
        "--token",
        "token",
        "task",
        "create",
        "--project",
        "prj_1",
        "--request",
        "work",
        "--attach",
        "/missing/file.txt",
      ),
      { io: output.io, fetch: async () => ok({ id: "tsk_1", version: 1 }, 201) },
    );
    expect(code).toBe(9);
    const result = JSON.parse(output.stderr());
    expect(result.partial).toBe(true);
    expect(result.task).toEqual({ id: "tsk_1", version: 1 });
    expect(result.error.code).toBe("file_read_error");
  });
});

describe("JSON agent flow", () => {
  test("creates, curates, claims, records a PR and completes using only JSON", async () => {
    let task = {
      id: "tsk_1",
      version: 1,
      status: "draft",
      curatorSpec: "",
      prUrl: null as string | null,
    };
    const requests: Request[] = [];
    const fetch = async (input: RequestInfo | URL) => {
      const request = new Request(input);
      requests.push(request.clone());
      const url = new URL(request.url);
      if (url.pathname.endsWith("/projects")) return ok({ id: "prj_1", name: "Project" }, 201);
      if (request.method === "POST" && url.pathname.endsWith("/tasks")) return ok(task, 201);
      if (request.method === "PATCH") {
        const body = await request.json();
        task = { ...task, ...body, version: task.version + 1 };
        return ok(task);
      }
      if (url.pathname.endsWith("/transition")) {
        const body = await request.json();
        task = { ...task, status: body.to, version: task.version + 1 };
        return ok(task);
      }
      return ok(task);
    };
    const commands = [
      [
        "project",
        "create",
        "--name",
        "Project",
        "--repository-path",
        "/repo",
        "--git-provider",
        "github",
        "--account-scope",
        "personal",
      ],
      ["task", "create", "--project", "prj_1", "--request", "Do work"],
      ["task", "update", "tsk_1", "--expected-version", "1", "--spec", "# Plan"],
      [
        "task",
        "transition",
        "tsk_1",
        "--expected-version",
        "2",
        "--from",
        "draft",
        "--to",
        "ready",
      ],
      [
        "task",
        "transition",
        "tsk_1",
        "--expected-version",
        "3",
        "--from",
        "ready",
        "--to",
        "implementing",
      ],
      [
        "task",
        "update",
        "tsk_1",
        "--expected-version",
        "4",
        "--pr-url",
        "https://example.test/pr/1",
      ],
      [
        "task",
        "transition",
        "tsk_1",
        "--expected-version",
        "5",
        "--from",
        "implementing",
        "--to",
        "done",
      ],
    ];
    for (const command of commands) {
      const output = harness();
      expect(
        await runCli(argv("--json", "--token", "token", ...command), { io: output.io, fetch }),
      ).toBe(0);
      expect(() => JSON.parse(output.stdout())).not.toThrow();
      expect(output.stderr()).toBe("");
    }
    expect(task).toMatchObject({ status: "done", version: 6, prUrl: "https://example.test/pr/1" });
    expect(
      requests.every((request) => request.headers.get("Authorization") === "Bearer token"),
    ).toBe(true);
  });
});
