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
    const verification = project?.commands.find((command) => command.name() === "verification");
    const task = program.commands.find((command) => command.name() === "task");
    const question = task?.commands.find((command) => command.name() === "question");
    const attachment = task?.commands.find((command) => command.name() === "attachment");
    const profile = program.commands.find((command) => command.name() === "agent-profile");
    const runner = program.commands.find((command) => command.name() === "runner");
    const connection = program.commands.find((command) => command.name() === "connection");
    const config = program.commands.find((command) => command.name() === "config");
    expect(program.commands.some((command) => command.name() === "doctor")).toBe(true);
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
      "metrics",
      "branches",
      "doctor",
      "verification",
      "update",
      "archive",
      "unarchive",
    ]);
    expect(verification?.commands.map((command) => command.name())).toEqual([
      "get",
      "history",
      "set",
      "disable",
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
    expect(connection?.commands.map((command) => command.name())).toEqual([
      "list",
      "github-install",
      "azure-authorize",
      "azure-organizations",
      "azure-complete",
      "reauthorize",
      "repos",
      "import",
      "revoke",
    ]);
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

describe("CLI doctor", () => {
  test("emits a stable healthy JSON diagnosis without exposing secrets", async () => {
    const token = "doctor-super-secret";
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path === "/api/v1/health") return ok({ status: "ok", version: "0.8.0" });
      expect(request.headers.get("Authorization")).toBe(`Bearer ${token}`);
      if (path === "/api/v1/connections") return ok([]);
      if (path === "/api/v1/system/runner") {
        return ok({ status: "online", lastSeenAt: "2026-07-25T10:00:00.000Z" });
      }
      return ok([{ id: "agt_1", enabled: true, credentialReference: "SECRET_REFERENCE" }]);
    };
    const output = harness();
    expect(await runCli(argv("--json", "--token", token, "doctor"), { io: output.io, fetch })).toBe(
      0,
    );
    const result = JSON.parse(output.stdout());
    expect(result).toEqual({
      ok: true,
      cliVersion: "0.8.0",
      apiUrl: "http://127.0.0.1:3000",
      checks: [
        {
          name: "configuration",
          status: "pass",
          message: "Effective configuration is valid.",
          details: { tokenConfigured: true },
        },
        {
          name: "health",
          status: "pass",
          message: "Server health is OK.",
          details: { serverVersion: "0.8.0" },
        },
        {
          name: "version",
          status: "pass",
          message: "CLI and Server versions match.",
          details: { serverVersion: "0.8.0" },
        },
        {
          name: "authentication",
          status: "pass",
          message: "Bearer authentication succeeded.",
          details: {},
        },
        {
          name: "runner",
          status: "pass",
          message: "Runner is online.",
          details: { status: "online" },
        },
        {
          name: "connections",
          status: "pass",
          message: "Connections do not require reauthorization.",
          details: {
            total: 0,
            byProvider: { github: 0, azure_devops: 0 },
            byStatus: { active: 0, reauthorization_required: 0, revoked: 0 },
            reauthorizationRequired: 0,
          },
        },
        {
          name: "agent_profiles",
          status: "pass",
          message: "All Agent Profiles are enabled.",
          details: { total: 1, enabled: 1, disabled: 0 },
        },
      ],
    });
    expect(output.stdout()).not.toContain(token);
    expect(output.stdout()).not.toContain("SECRET_REFERENCE");
    expect(output.stderr()).toBe("");
  });

  test("keeps all checks and exits 3 when the token is absent", async () => {
    const output = harness();
    let requests = 0;
    expect(
      await runCli(argv("--json", "doctor"), {
        io: output.io,
        environment: {},
        fetch: async () => {
          requests += 1;
          return ok({ status: "ok", version: "0.8.0" });
        },
      }),
    ).toBe(3);
    const result = JSON.parse(output.stdout());
    expect(requests).toBe(1);
    expect(result.checks.map((check: { status: string }) => check.status)).toEqual([
      "fail",
      "pass",
      "pass",
      "skipped",
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(output.stderr()).toBe("");
  });

  test("maps invalid auth, unhealthy responses, and network failures", async () => {
    const cases = [
      {
        expected: 3,
        fetch: async (input: string | URL | Request) =>
          new URL(new Request(input).url).pathname === "/api/v1/health"
            ? ok({ status: "ok", version: "0.8.0" })
            : error(401, "unauthorized"),
      },
      {
        expected: 6,
        fetch: async () => ok({ status: "unhealthy", version: "0.8.0" }, 503),
      },
      {
        expected: 7,
        fetch: async () => {
          throw new Error("network failed with should-not-leak");
        },
      },
    ];
    for (const item of cases) {
      const output = harness();
      expect(
        await runCli(argv("--json", "--token", "should-not-leak", "doctor"), {
          io: output.io,
          fetch: item.fetch,
        }),
      ).toBe(item.expected);
      const result = JSON.parse(output.stdout());
      expect(result.checks).toHaveLength(7);
      expect(output.stdout()).not.toContain("should-not-leak");
      expect(output.stderr()).toBe("");
    }
  });

  test("treats version, runner, reauthorization, and disabled profiles as warnings", async () => {
    for (const runnerStatus of ["offline", "unknown"]) {
      const output = harness();
      const fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(new Request(input, init).url).pathname;
        if (path === "/api/v1/health") return ok({ status: "ok", version: "0.5.1" });
        if (path === "/api/v1/connections") {
          return ok([
            {
              provider: "azure_devops",
              status: "reauthorization_required",
              refreshToken: "never-output",
            },
          ]);
        }
        if (path === "/api/v1/system/runner") return ok({ status: runnerStatus });
        return ok([{ enabled: false, credentialReference: "NEVER_OUTPUT" }]);
      };
      expect(
        await runCli(argv("--json", "--token", "token", "doctor"), {
          io: output.io,
          fetch,
        }),
      ).toBe(0);
      const result = JSON.parse(output.stdout());
      expect(result.ok).toBe(true);
      expect(
        result.checks
          .filter((check: { status: string }) => check.status === "warning")
          .map((check: { name: string }) => check.name),
      ).toEqual(["version", "runner", "connections", "agent_profiles"]);
      expect(output.stdout()).not.toContain("never-output");
      expect(output.stdout()).not.toContain("NEVER_OUTPUT");
    }
  });

  test("renders the same safe diagnosis in human mode", async () => {
    const output = harness();
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(new Request(input, init).url).pathname;
      if (path === "/api/v1/health") return ok({ status: "ok", version: "0.8.0" });
      if (path === "/api/v1/connections") return ok([]);
      if (path === "/api/v1/system/runner") return ok({ status: "online" });
      return ok([]);
    };
    expect(await runCli(argv("--token", "human-secret", "doctor"), { io: output.io, fetch })).toBe(
      0,
    );
    expect(output.stdout()).toContain("[PASS] health");
    expect(output.stdout()).toContain("[WARNING] agent_profiles");
    expect(output.stdout()).not.toContain("human-secret");
    expect(output.stderr()).toBe("");
  });
});

describe("CLI inputs and commands", () => {
  test("runs standard and deep Project Readiness with stable exit codes", async () => {
    const requests: Array<{ readonly path: string; readonly body: unknown }> = [];
    for (const item of [
      { flags: [] as string[], ok: true, expectedDepth: "standard", exitCode: 0 },
      { flags: ["--deep"], ok: false, expectedDepth: "deep", exitCode: 6 },
    ]) {
      const output = harness();
      const fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push({
          path: new URL(request.url).pathname,
          body: await request.clone().json(),
        });
        return ok({
          projectId: "prj_01K0ABCDEFGHIJKLMNOPQRSTUV",
          depth: item.expectedDepth,
          checkedAt: "2026-07-26T10:00:00.000Z",
          durationMs: 5,
          ok: item.ok,
          checks: [],
        });
      };
      expect(
        await runCli(
          argv(
            "--json",
            "--token",
            "token",
            "project",
            "doctor",
            "prj_01K0ABCDEFGHIJKLMNOPQRSTUV",
            ...item.flags,
          ),
          { io: output.io, fetch },
        ),
      ).toBe(item.exitCode);
      expect(JSON.parse(output.stdout()).depth).toBe(item.expectedDepth);
      expect(output.stderr()).toBe("");
    }
    expect(requests).toEqual([
      {
        path: "/api/v1/projects/prj_01K0ABCDEFGHIJKLMNOPQRSTUV/readiness-check",
        body: { depth: "standard" },
      },
      {
        path: "/api/v1/projects/prj_01K0ABCDEFGHIJKLMNOPQRSTUV/readiness-check",
        body: { depth: "deep" },
      },
    ]);
  });

  test("lists and completes Azure authorizations with full IDs and exact requests", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        ...(request.method === "POST" ? { body: await request.clone().json() } : {}),
      });
      return request.method === "GET"
        ? ok([{ id: "org-full-id", name: "Work" }])
        : ok({ id: "con_full_id", provider: "azure_devops" }, 201);
    };

    for (const command of [
      ["connection", "azure-organizations", "azr_FULL_AUTHORIZATION_ID"],
      [
        "connection",
        "azure-complete",
        "azr_FULL_AUTHORIZATION_ID",
        "--organization-id",
        "org-full-id",
      ],
    ]) {
      const output = harness();
      expect(
        await runCli(argv("--json", "--token", "token", ...command), { io: output.io, fetch }),
      ).toBe(0);
    }
    expect(requests).toEqual([
      {
        method: "GET",
        path: "/api/v1/connections/azure-devops/authorizations/azr_FULL_AUTHORIZATION_ID/organizations",
      },
      {
        method: "POST",
        path: "/api/v1/connections/azure-devops/authorizations/azr_FULL_AUTHORIZATION_ID/complete",
        body: { organizationId: "org-full-id" },
      },
    ]);
  });

  test("updates managed Project settings in one exact PATCH and clears nullable fields", async () => {
    const bodies: unknown[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      bodies.push(await request.json());
      return ok({ id: "prj_1" });
    };
    const combined = harness();
    expect(
      await runCli(
        argv(
          "--json",
          "--token",
          "token",
          "project",
          "update",
          "prj_1",
          "--curation-agent-profile",
          "agt_curator",
          "--implementation-agent-profile",
          "agt_implementer",
          "--enable-automation",
          "--schedule-cron",
          "0 9 * * 1-5",
          "--schedule-timezone",
          "Europe/Madrid",
          "--max-concurrency",
          "16",
          "--ready-policy",
          "manual-approval-required",
        ),
        { io: combined.io, fetch },
      ),
    ).toBe(0);
    const cleared = harness();
    expect(
      await runCli(
        argv(
          "--json",
          "--token",
          "token",
          "project",
          "update",
          "prj_1",
          "--clear-curation-agent-profile",
          "--clear-implementation-agent-profile",
          "--disable-automation",
          "--clear-schedule",
        ),
        { io: cleared.io, fetch },
      ),
    ).toBe(0);
    expect(bodies).toEqual([
      {
        scheduleTimezone: "Europe/Madrid",
        maxConcurrency: 16,
        readyPolicy: "manual_approval_required",
        curationAgentProfileId: "agt_curator",
        implementationAgentProfileId: "agt_implementer",
        automationEnabled: true,
        scheduleCron: "0 9 * * 1-5",
      },
      {
        curationAgentProfileId: null,
        implementationAgentProfileId: null,
        automationEnabled: false,
        scheduleCron: null,
      },
    ]);
  });

  test("manages Verification Contract JSON with exact revision requests", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        ...(request.method === "PUT" || request.method === "POST"
          ? { body: await request.clone().json() }
          : {}),
      });
      return ok({ projectId: "prj_1", latestRevision: 1, active: null });
    };
    const commands = [
      {
        name: "tests",
        executable: "bun",
        args: ["test"],
        required: true,
        timeoutSeconds: 300,
      },
    ];
    const set = harness({ stdin: JSON.stringify(commands) });
    expect(
      await runCli(
        argv(
          "--json",
          "--token",
          "token",
          "project",
          "verification",
          "set",
          "prj_1",
          "--file",
          "-",
          "--expected-revision",
          "none",
        ),
        { io: set.io, fetch },
      ),
    ).toBe(0);
    for (const command of [
      ["project", "verification", "get", "prj_1"],
      ["project", "verification", "history", "prj_1"],
      ["project", "verification", "disable", "prj_1", "--expected-revision", "1"],
    ]) {
      expect(
        await runCli(argv("--json", "--token", "token", ...command), {
          io: harness().io,
          fetch,
        }),
      ).toBe(0);
    }
    expect(requests).toEqual([
      {
        method: "PUT",
        path: "/api/v1/projects/prj_1/verification-contract",
        body: { expectedRevision: null, commands },
      },
      { method: "GET", path: "/api/v1/projects/prj_1/verification-contract" },
      { method: "GET", path: "/api/v1/projects/prj_1/verification-contract/revisions" },
      {
        method: "POST",
        path: "/api/v1/projects/prj_1/verification-contract/disable",
        body: { expectedRevision: 1 },
      },
    ]);
  });

  test("rejects managed Project conflicts and concurrency limits locally", async () => {
    for (const flags of [
      ["--enable-automation", "--disable-automation"],
      ["--schedule-cron", "* * * * *", "--clear-schedule"],
      ["--curation-agent-profile", "agt_1", "--clear-curation-agent-profile"],
      ["--implementation-agent-profile", "agt_1", "--clear-implementation-agent-profile"],
      ["--max-concurrency", "0"],
      ["--max-concurrency", "17"],
    ]) {
      const output = harness();
      let called = false;
      expect(
        await runCli(argv("--json", "--token", "token", "project", "update", "prj_1", ...flags), {
          io: output.io,
          fetch: async () => {
            called = true;
            return ok({});
          },
        }),
      ).toBe(2);
      expect(called).toBe(false);
      expect(JSON.parse(output.stderr()).error.code).toBe("invalid_input");
    }
  });

  test("preserves Server validation errors for invalid managed Project settings", async () => {
    const output = harness();
    expect(
      await runCli(
        argv("--json", "--token", "token", "project", "update", "prj_1", "--enable-automation"),
        { io: output.io, fetch: async () => error(422, "validation_error") },
      ),
    ).toBe(2);
    expect(JSON.parse(output.stderr()).error.code).toBe("validation_error");
  });

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

  test("exports Project metrics with the exact UTC range", async () => {
    const output = harness();
    const requests: string[] = [];
    const code = await runCli(
      argv(
        "--json",
        "--token",
        "token",
        "project",
        "metrics",
        "prj_1",
        "--from",
        "2026-01-01T00:00:00.000Z",
        "--to",
        "2026-02-01T00:00:00.000Z",
      ),
      {
        io: output.io,
        fetch: async (input) => {
          requests.push(input instanceof Request ? input.url : String(input));
          return ok({ projectId: "prj_1", coverage: { tasks: 0 } });
        },
      },
    );
    expect(code).toBe(0);
    expect(requests[0]).toContain(
      "/projects/prj_1/metrics?from=2026-01-01T00%3A00%3A00.000Z&to=2026-02-01T00%3A00%3A00.000Z",
    );
    expect(JSON.parse(output.stdout())).toMatchObject({ projectId: "prj_1" });
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
