import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  AttachmentUseCases,
  createTask,
  type ProjectId,
  type TaskId,
  ProjectUseCases,
  QuestionUseCases,
  SystemClock,
  TaskUseCases,
  UlidIdGenerator,
  AgentProfileUseCases,
  ConnectionUseCases,
  RunUseCases,
  MessageUseCases,
  VerificationContractUseCases,
} from "@aiws/core";
import { FileAttachmentBlobStore, openDatabase, SqliteUnitOfWork } from "@aiws/sqlite";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { createApp } from "../src/http/app.ts";
import { GitHubAppGateway } from "../src/integrations/github-app.ts";
import type { LogEntry, Logger } from "../src/logging/logger.ts";
import type { ProductMetricsService } from "../src/metrics.ts";
import { RepositoryValidator } from "../src/repositories/repository-validator.ts";
import { RunnerActivityMonitor } from "../src/runner-activity.ts";

const token = "test-api-token-that-is-at-least-32-bytes";
const runnerToken = "test-runner-token-that-is-at-least-32-bytes";
const sessionSecret = Buffer.alloc(32, 9).toString("base64");
let passwordHash = "";
const temporaryDirectories: string[] = [];

function profileSelection() {
  const model = {
    id: "gpt-test",
    name: "GPT Test",
    description: "Fixture model",
    isDefault: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  };
  return {
    model: model.id,
    reasoningEffort: model.defaultReasoningEffort,
    catalog: { models: [model] },
  };
}

beforeAll(async () => {
  passwordHash = await Bun.password.hash("correct horse battery staple", {
    algorithm: "argon2id",
    memoryCost: 4096,
    timeCost: 1,
  });
});

afterAll(async () => {
  for (const directory of temporaryDirectories) await rm(directory, { recursive: true });
});

describe("Hito 3 server", () => {
  test("exposes authenticated Project metrics with strict UTC ranges", async () => {
    const calls: unknown[][] = [];
    const fixture = await createFixture({
      metrics: {
        project: (...arguments_) => {
          calls.push(arguments_);
          return {
            projectId: arguments_[0],
            from: arguments_[1],
            to: arguments_[2],
            generatedAt: "2026-07-21T12:00:00.000Z",
            coverage: {
              tasks: 0,
              readySamples: 0,
              runs: 0,
              runsWithProvenance: 0,
              deliveries: 0,
              deliveriesObserved: 0,
              staleDeliveries: 0,
            },
            flow: {
              requestToReadyAverageMs: null,
              blockedDurationMs: 0,
              blockedSamples: 0,
              questions: 0,
            },
            runs: {
              curation: { count: 0, completedSamples: 0, averageDurationMs: null },
              implementation: { count: 0, completedSamples: 0, averageDurationMs: null },
              firstAttemptSucceeded: 0,
              firstAttempts: 0,
            },
            retries: { full: 0, publishOnly: 0, waiver: 0 },
            verification: { passed: 0, failed: 0, requiredFailed: 0 },
            delivery: { pullRequests: 0, mergedObserved: 0 },
          };
        },
      },
    });
    try {
      const projectId = "prj_00000000000000000000000000";
      const from = "2026-01-01T00:00:00.000Z";
      const to = "2026-02-01T00:00:00.000Z";
      const response = await fixture.app.request(
        `/api/v1/projects/${projectId}/metrics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        bearer(),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ projectId, from, to });
      expect(calls).toEqual([[projectId, from, to]]);

      const invalid = await fixture.app.request(
        `/api/v1/projects/${projectId}/metrics?from=2026-01-01&to=${encodeURIComponent(to)}`,
        bearer(),
      );
      expect(invalid.status).toBe(422);
      const anonymous = await fixture.app.request(
        `/api/v1/projects/${projectId}/metrics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      expect(anonymous.status).toBe(401);
    } finally {
      await fixture.close();
    }
  });

  test("exposes authenticated standard and deep Project Readiness reports", async () => {
    const calls: Array<{ readonly projectId: string; readonly depth: string }> = [];
    const fixture = await createFixture({
      projectReadiness: {
        check: async (projectId, depth) => {
          calls.push({ projectId, depth });
          return {
            projectId,
            depth,
            checkedAt: "2026-07-21T12:00:00.000Z",
            durationMs: 4,
            ok: true,
            checks: [
              {
                id: "runner",
                status: "pass",
                message: "Runner is online.",
                details: { status: "online" },
              },
            ],
          };
        },
      },
    });
    try {
      const projectId = "prj_00000000000000000000000000";
      const response = await fixture.app.request(
        `/api/v1/projects/${projectId}/readiness-check`,
        jsonRequest("POST", { depth: "deep" }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ projectId, depth: "deep", ok: true });
      expect(calls).toEqual([{ projectId, depth: "deep" }]);

      const invalid = await fixture.app.request(
        `/api/v1/projects/${projectId}/readiness-check`,
        jsonRequest("POST", { depth: "unsafe" }),
      );
      expect(invalid.status).toBe(422);
      const anonymous = await fixture.app.request(`/api/v1/projects/${projectId}/readiness-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(anonymous.status).toBe(401);
    } finally {
      await fixture.close();
    }
  });

  test("lists GitHub branches and snapshots the selected branch when creating a Task", async () => {
    const fixture = await createFixture({ github: githubWithBranches(["main", "release/next"]) });
    try {
      const connection = await fixture.connections.register({
        host: "https://github.com",
        externalAccountId: "42",
        displayName: "acme",
        installationId: "42",
      });
      const project = await fixture.projects.createManaged({
        name: "Managed branches",
        repositoryPath: fixture.repository,
        accountScope: "personal",
        connectionId: connection.id,
        remoteRepositoryId: "42",
        remoteFullName: "acme/managed",
        remoteWebUrl: "https://github.com/acme/managed",
        defaultBranch: "main",
      });

      const listed = await fixture.app.request(`/api/v1/projects/${project.id}/branches`, bearer());
      expect(listed.status).toBe(200);
      expect(await listed.json()).toEqual([
        { name: "main", sha: "a".repeat(40), protected: true },
        { name: "release/next", sha: "b".repeat(40), protected: false },
      ]);

      const updated = await fixture.app.request(
        `/api/v1/projects/${project.id}`,
        jsonRequest("PATCH", { defaultBranch: "release/next" }),
      );
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ defaultBranch: "release/next" });

      const created = await fixture.app.request(
        "/api/v1/tasks",
        jsonRequest("POST", {
          projectId: project.id,
          userRequest: "Build it",
          baseBranch: "main",
        }),
      );
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({
        currentDelivery: { baseBranch: "main" },
      });

      const invalid = await fixture.app.request(
        "/api/v1/tasks",
        jsonRequest("POST", {
          projectId: project.id,
          userRequest: "Build it elsewhere",
          baseBranch: "missing",
        }),
      );
      expect(invalid.status).toBe(422);
      expect(await errorCode(invalid)).toBe("validation_error");
    } finally {
      await fixture.close();
    }
  });

  test("protects notification settings, masks the token, validates Origin and maps test failure", async () => {
    let settings = {
      enabled: false,
      baseUrl: "https://ntfy.sh",
      topic: "",
      accessTokenConfigured: false,
      updatedAt: "2026-07-21T12:00:00.000Z",
    };
    let failTest = false;
    const notificationSettings = {
      get: () => settings,
      update: async (patch: {
        enabled?: boolean;
        baseUrl?: string;
        topic?: string;
        accessToken?: string | null;
      }) => {
        settings = {
          ...settings,
          ...patch,
          accessTokenConfigured:
            patch.accessToken === undefined
              ? settings.accessTokenConfigured
              : patch.accessToken !== null,
          updatedAt: "2026-07-21T12:00:00.000Z",
        };
        const { accessToken: _, ...masked } = settings as typeof settings & {
          accessToken?: string | null;
        };
        settings = masked;
        return settings;
      },
      test: async () => {
        if (failTest) throw new Error("secret upstream body");
      },
    };
    const fixture = await createFixture({ notificationSettings });
    try {
      expect((await fixture.app.request("/api/v1/notification-settings")).status).toBe(401);
      const initial = await fixture.app.request("/api/v1/notification-settings", bearer());
      expect(initial.status).toBe(200);
      expect(JSON.stringify(await initial.json())).not.toContain("accessToken:");

      const loggedIn = await login(fixture, "admin", "correct horse battery staple");
      const cookie = (loggedIn.headers.get("Set-Cookie") ?? "").split(";", 1)[0] as string;
      const forbidden = await fixture.app.request("/api/v1/notification-settings", {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      expect(forbidden.status).toBe(403);

      const updated = await fixture.app.request("/api/v1/notification-settings", {
        method: "PATCH",
        headers: {
          Cookie: cookie,
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: true,
          topic: "private_topic",
          accessToken: "must-never-be-returned",
        }),
      });
      expect(updated.status).toBe(200);
      const updatedBody = await updated.clone().json();
      expect(updatedBody).toMatchObject({
        enabled: true,
        topic: "private_topic",
        accessTokenConfigured: true,
      });
      expect(await updated.text()).not.toContain("must-never-be-returned");

      expect(
        (
          await fixture.app.request("/api/v1/notification-settings/test", {
            method: "POST",
            headers: bearer().headers,
          })
        ).status,
      ).toBe(204);
      failTest = true;
      const failed = await fixture.app.request("/api/v1/notification-settings/test", {
        method: "POST",
        headers: bearer().headers,
      });
      expect(failed.status).toBe(503);
      expect(await errorCode(failed.clone())).toBe("notification_unavailable");
      expect(await failed.text()).not.toContain("secret upstream body");
    } finally {
      await fixture.close();
    }
  });

  test("reports authenticated runner liveness from system activity", async () => {
    const runnerActivity = new RunnerActivityMonitor(
      () => new Date("2026-07-21T12:00:00.000Z"),
      45_000,
    );
    const fixture = await createFixture({ runnerActivity });
    try {
      expect(
        await (await fixture.app.request("/api/v1/system/runner", bearer())).json(),
      ).toMatchObject({ status: "unknown", lastSeenAt: null });
      const reconcile = await fixture.app.request("/api/v1/runs/reconcile", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${runnerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ before: "2026-07-21T11:55:00.000Z" }),
      });
      expect(reconcile.status).toBe(200);
      expect(
        await (await fixture.app.request("/api/v1/system/runner", bearer())).json(),
      ).toMatchObject({
        status: "online",
        lastSeenAt: "2026-07-21T12:00:00.000Z",
      });
    } finally {
      await fixture.close();
    }
  });

  test("serves the live model catalog and validates profile model/effort pairs", async () => {
    const fixture = await createFixture();
    try {
      const catalog = await fixture.app.request(
        "/api/v1/agent-profiles/model-catalog",
        jsonRequest("POST", {
          authMode: "api_key",
          credentialReference: "OPENAI_API_KEY",
        }),
      );
      expect(catalog.status).toBe(200);
      expect(await catalog.json()).toEqual(profileSelection().catalog);

      const created = await fixture.app.request(
        "/api/v1/agent-profiles",
        jsonRequest("POST", {
          name: "Catalog profile",
          authMode: "api_key",
          credentialReference: "OPENAI_API_KEY",
          model: "gpt-test",
          reasoningEffort: "high",
        }),
      );
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({
        model: "gpt-test",
        reasoningEffort: "high",
      });

      for (const selection of [
        { model: "unknown", reasoningEffort: "high" },
        { model: "gpt-test", reasoningEffort: "extreme" },
      ]) {
        const rejected = await fixture.app.request(
          "/api/v1/agent-profiles",
          jsonRequest("POST", {
            name: `Rejected ${selection.model} ${selection.reasoningEffort}`,
            authMode: "api_key",
            credentialReference: "OPENAI_API_KEY",
            ...selection,
          }),
        );
        expect(rejected.status).toBe(422);
      }
    } finally {
      await fixture.close();
    }
  });

  test("returns catalog_unavailable when runner control is not configured", async () => {
    const fixture = await createFixture({ modelCatalog: null });
    try {
      const response = await fixture.app.request(
        "/api/v1/agent-profiles/model-catalog",
        jsonRequest("POST", {
          authMode: "api_key",
          credentialReference: "MISSING_KEY",
        }),
      );
      expect(response.status).toBe(503);
      expect(await errorCode(response)).toBe("catalog_unavailable");
    } finally {
      await fixture.close();
    }
  });

  test("separates runner authority and persists authenticated Run logs", async () => {
    const fixture = await createFixture();
    try {
      const profile = await fixture.agentProfiles.create({
        name: "Codex",
        authMode: "api_key",
        credentialReference: "OPENAI_API_KEY",
        ...profileSelection(),
      });
      const connection = await fixture.connections.register({
        host: "https://github.com",
        externalAccountId: "42",
        displayName: "acme",
        installationId: "42",
      });
      const project = await fixture.projects.createManaged({
        name: "Managed",
        repositoryPath: fixture.repository,
        accountScope: "personal",
        connectionId: connection.id,
        remoteRepositoryId: "42",
        remoteFullName: "acme/managed",
        remoteWebUrl: "https://github.com/acme/managed",
        defaultBranch: "main",
      });
      await fixture.projects.update(project.id, {
        curationAgentProfileId: profile.id,
        implementationAgentProfileId: profile.id,
        automationEnabled: true,
      });
      let task = await fixture.tasks.create({
        projectId: project.id,
        userRequest: "Implement it",
        actorType: "web",
      });
      task = await fixture.tasks.update({
        taskId: task.id,
        expectedVersion: task.version,
        changes: { curatorSpec: "Implement and test." },
        actorType: "web",
      });
      task = await fixture.tasks.transition({
        taskId: task.id,
        expectedVersion: task.version,
        from: "draft",
        to: "curating",
        actorType: "web",
      });
      task = await fixture.tasks.transition({
        taskId: task.id,
        expectedVersion: task.version,
        from: "curating",
        to: "ready",
        actorType: "web",
      });
      const assignment = await fixture.runs.claimNext();
      if (assignment === null) throw new Error("Run was not claimed");
      const path = `/api/v1/runs/${assignment.run.id}/logs`;
      expect(
        (
          await fixture.app.request(path, {
            method: "PUT",
            headers: bearer().headers,
            body: "{}\n",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fixture.app.request(path, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${runnerToken}`,
              "Content-Type": "application/x-ndjson",
            },
            body: '{"type":"turn.completed"}\n',
          })
        ).status,
      ).toBe(204);
      const logs = await fixture.app.request(path, bearer());
      expect(logs.status).toBe(200);
      expect(await logs.text()).toBe('{"type":"turn.completed"}\n');
      const missingVersion = await fixture.app.request(`/api/v1/runs/${assignment.run.id}/cancel`, {
        method: "POST",
        headers: { ...bearer().headers, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Stop" }),
      });
      expect(missingVersion.status).toBe(428);

      await fixture.runs.fail(assignment.run.id, {
        errorCode: "publish_failed",
        errorMessage: "Remote rejected credentials.",
      });
      const paused = await fixture.tasks.get(task.id);
      expect(paused).toMatchObject({ status: "ready", automationPaused: true });

      const staleResume = await fixture.app.request(
        `/api/v1/tasks/${task.id}/automation/resume`,
        taskMutation("POST", paused.version - 1),
      );
      expect(staleResume.status).toBe(409);
      expect(await errorCode(staleResume)).toBe("version_conflict");

      const resumed = await fixture.app.request(
        `/api/v1/tasks/${task.id}/automation/resume`,
        taskMutation("POST", paused.version),
      );
      expect(resumed.status).toBe(200);
      expect(resumed.headers.get("ETag")).toBe(`"${paused.version + 1}"`);
      expect(await resumed.json()).toMatchObject({
        version: paused.version + 1,
        status: "ready",
        automationPaused: false,
      });
    } finally {
      await fixture.close();
    }
  });

  test("accepts structured curation results only from the runner", async () => {
    const fixture = await createFixture();
    try {
      const profile = await fixture.agentProfiles.create({
        name: "Curator",
        authMode: "api_key",
        credentialReference: "OPENAI_API_KEY",
        ...profileSelection(),
      });
      const connection = await fixture.connections.register({
        host: "https://github.com",
        externalAccountId: "84",
        displayName: "curator",
        installationId: "84",
      });
      const project = await fixture.projects.createManaged({
        name: "Managed curation",
        repositoryPath: fixture.repository,
        accountScope: "personal",
        connectionId: connection.id,
        remoteRepositoryId: "84",
        remoteFullName: "acme/curation",
        remoteWebUrl: "https://github.com/acme/curation",
        defaultBranch: "main",
      });
      await fixture.projects.update(project.id, { curationAgentProfileId: profile.id });
      let task = await fixture.tasks.create({
        projectId: project.id,
        userRequest: "Clarify and implement",
        actorType: "web",
      });
      task = await fixture.tasks.transition({
        taskId: task.id,
        expectedVersion: task.version,
        from: "draft",
        to: "curating",
        actorType: "web",
      });
      const assignment = await fixture.runs.claimNext();
      if (assignment === null) throw new Error("Curation was not claimed");
      await fixture.runs.advance(assignment.run.id, "running");
      const path = `/api/v1/runs/${assignment.run.id}/curation-result`;
      const payload = {
        outcome: "blocked",
        title: "Clarified request",
        questions: [{ text: "Which target?", type: "text", options: [], allowOther: false }],
        summary: "A product decision is required.",
      };
      const forbidden = await fixture.app.request(path, jsonRequest("POST", payload));
      expect(forbidden.status).toBe(403);
      const completed = await fixture.app.request(path, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${runnerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      expect(completed.status).toBe(200);
      expect(await completed.json()).toMatchObject({
        kind: "curation",
        outcome: "blocked",
        status: "succeeded",
      });
      const aggregate = await fixture.tasks.get(task.id);
      expect(aggregate).toMatchObject({
        title: "Clarified request",
        status: "blocked",
        version: assignment.task.version + 1,
      });
      expect(aggregate.questions).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  test("exposes health publicly and protects every other API route", async () => {
    const fixture = await createFixture();
    try {
      const health = await fixture.app.request("/api/v1/health");
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok", version: "0.8.0" });
      expect(health.headers.get("X-Request-Id")).toStartWith("req_");
      expect(health.headers.get("Content-Security-Policy")).not.toContain("unsafe-eval");
      expect(health.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(health.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(health.headers.get("X-Frame-Options")).toBe("DENY");
      expect(health.headers.get("Permissions-Policy")).toContain("camera=()");

      for (const headers of [undefined, { Authorization: "Bearer incorrect" }]) {
        const response = await fixture.app.request(
          "/api/v1/projects",
          headers === undefined ? undefined : { headers },
        );
        expect(response.status).toBe(401);
        expect(await errorCode(response)).toBe("unauthorized");
        expect(response.headers.get("X-Request-Id")).toStartWith("req_");
      }
      const invalidCookie = await fixture.app.request("/api/v1/projects", {
        headers: { Cookie: "aiws_session=invalid" },
      });
      expect(invalidCookie.status).toBe(401);

      const authorized = await fixture.app.request("/api/v1/projects", bearer());
      expect(authorized.status).toBe(200);
      expect(await authorized.json()).toEqual({ items: [], nextCursor: null });
    } finally {
      await fixture.close();
    }
  });

  test("reports unhealthy when the SQLite health probe fails", async () => {
    const fixture = await createFixture({
      healthCheck: () => {
        throw new Error("database unavailable");
      },
    });
    try {
      const response = await fixture.app.request("/api/v1/health");
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "unhealthy", version: "0.8.0" });
    } finally {
      await fixture.close();
    }
  });

  test("handles login, session, cookie origin protection and logout", async () => {
    const fixture = await createFixture();
    try {
      const failed = await login(fixture, "admin", "wrong");
      expect(failed.status).toBe(401);
      expect(await errorCode(failed)).toBe("unauthorized");

      const response = await login(fixture, "admin", "correct horse battery staple");
      expect(response.status).toBe(204);
      const setCookie = response.headers.get("Set-Cookie") ?? "";
      expect(setCookie).toContain("aiws_session=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Strict");
      expect(setCookie).not.toContain("Secure");
      const cookie = setCookie.split(";", 1)[0] as string;

      const session = await fixture.app.request("/api/v1/auth/session", {
        headers: { Cookie: cookie },
      });
      expect(session.status).toBe(200);
      expect(await session.json()).toEqual({ authenticated: true, username: "admin" });

      const noOrigin = await fixture.app.request("/api/v1/projects", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify(projectInput(fixture.repository)),
      });
      expect(noOrigin.status).toBe(403);
      expect(await errorCode(noOrigin)).toBe("forbidden");

      const wrongOrigin = await fixture.app.request("/api/v1/projects", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "http://evil.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(projectInput(fixture.repository)),
      });
      expect(wrongOrigin.status).toBe(403);

      const created = await fixture.app.request("/api/v1/projects", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(projectInput(fixture.repository)),
      });
      expect(created.status).toBe(201);

      const bearerSession = await fixture.app.request("/api/v1/auth/session", bearer());
      expect(bearerSession.status).toBe(401);

      const logout = await fixture.app.request("/api/v1/auth/logout", {
        method: "POST",
        headers: { Cookie: cookie, Origin: "http://localhost:3000" },
      });
      expect(logout.status).toBe(204);
      expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
    } finally {
      await fixture.close();
    }
  });

  test("sets Secure on production sessions", async () => {
    const fixture = await createFixture({
      production: true,
      publicUrl: "https://aiws.example.com",
    });
    try {
      const response = await login(fixture, "admin", "correct horse battery staple");
      expect(response.status).toBe(204);
      expect(response.headers.get("Set-Cookie")).toContain("Secure");
    } finally {
      await fixture.close();
    }
  });

  test("rate limits login without exposing credentials in logs", async () => {
    const logger = new MemoryLogger();
    const fixture = await createFixture({ loginAttempts: 2, logger });
    try {
      expect((await login(fixture, "admin", "secret-one")).status).toBe(401);
      expect((await login(fixture, "missing", "secret-two")).status).toBe(401);
      const limited = await login(fixture, "admin", "secret-three");
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
      const logs = JSON.stringify(logger.entries);
      expect(logs).not.toContain("secret-one");
      expect(logs).not.toContain("secret-two");
      expect(logs).not.toContain("secret-three");
      expect(logs).not.toContain(token);
    } finally {
      await fixture.close();
    }
  });

  test("implements the Projects API contract including archive idempotency", async () => {
    const fixture = await createFixture();
    try {
      const createdResponse = await fixture.app.request(
        "/api/v1/projects",
        jsonRequest("POST", projectInput(fixture.repository)),
      );
      expect(createdResponse.status).toBe(201);
      const created = (await createdResponse.json()) as {
        id: string;
        repositoryPath: string;
        curationAgentProfileId: string | null;
        implementationAgentProfileId: string | null;
        readyPolicy: string;
        agentProfileId?: string | null;
      };
      expect(created.id).toMatch(/^prj_[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(created.repositoryPath).toBe(fixture.repository);
      expect(created.curationAgentProfileId).toBeNull();
      expect(created.implementationAgentProfileId).toBeNull();
      expect(created.readyPolicy).toBe("curator_decides");
      expect(created.agentProfileId).toBeUndefined();

      const duplicate = await fixture.app.request(
        "/api/v1/projects",
        jsonRequest("POST", projectInput(fixture.repository)),
      );
      expect(duplicate.status).toBe(422);
      expect(await errorCode(duplicate)).toBe("validation_error");

      const list = await fixture.app.request(
        "/api/v1/projects?gitProvider=github&accountScope=personal&limit=1",
        bearer(),
      );
      expect(list.status).toBe(200);
      expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(1);

      const updated = await fixture.app.request(
        `/api/v1/projects/${created.id}`,
        jsonRequest("PATCH", {
          name: "Renamed",
          readyPolicy: "manual_approval_required",
        }),
      );
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({
        name: "Renamed",
        readyPolicy: "manual_approval_required",
      });

      const archived = await fixture.app.request(`/api/v1/projects/${created.id}/archive`, {
        method: "POST",
        ...bearer(),
      });
      expect(archived.status).toBe(200);
      const archivedBody = (await archived.json()) as { archivedAt: string };
      expect(archivedBody.archivedAt).not.toBeNull();

      const archivedAgain = await fixture.app.request(`/api/v1/projects/${created.id}/archive`, {
        method: "POST",
        ...bearer(),
      });
      expect(await archivedAgain.json()).toEqual(archivedBody);

      const readOnly = await fixture.app.request(
        `/api/v1/projects/${created.id}`,
        jsonRequest("PATCH", { name: "Cannot change" }),
      );
      expect(readOnly.status).toBe(409);
      expect(await errorCode(readOnly)).toBe("invalid_transition");

      const restored = await fixture.app.request(`/api/v1/projects/${created.id}/unarchive`, {
        method: "POST",
        ...bearer(),
      });
      expect(restored.status).toBe(200);
      expect(((await restored.json()) as { archivedAt: null }).archivedAt).toBeNull();

      const missing = await fixture.app.request(
        "/api/v1/projects/prj_00000000000000000000000000",
        bearer(),
      );
      expect(missing.status).toBe(404);
      expect(await errorCode(missing)).toBe("not_found");
    } finally {
      await fixture.close();
    }
  });

  test("manages an append-only Verification Contract with revision conflicts", async () => {
    const fixture = await createFixture();
    try {
      const created = await fixture.projects.create({
        name: "Verification API",
        repositoryPath: fixture.repository,
        gitProvider: "github",
        accountScope: "work",
      });
      const command = {
        name: "tests",
        executable: "bun",
        args: ["test"],
        required: true,
        timeoutSeconds: 300,
      };
      const initial = await fixture.app.request(
        `/api/v1/projects/${created.id}/verification-contract`,
        jsonRequest("PUT", { expectedRevision: null, commands: [command] }),
      );
      expect(initial.status).toBe(200);
      expect(await initial.json()).toMatchObject({
        latestRevision: 1,
        active: { revision: 1, commands: [command] },
      });

      const stale = await fixture.app.request(
        `/api/v1/projects/${created.id}/verification-contract`,
        jsonRequest("PUT", { expectedRevision: null, commands: [command] }),
      );
      expect(stale.status).toBe(409);
      expect(await errorCode(stale)).toBe("revision_conflict");

      const disabled = await fixture.app.request(
        `/api/v1/projects/${created.id}/verification-contract/disable`,
        jsonRequest("POST", { expectedRevision: 1 }),
      );
      expect(disabled.status).toBe(200);
      expect(await disabled.json()).toEqual({
        projectId: created.id,
        latestRevision: 2,
        active: null,
      });
      const history = await fixture.app.request(
        `/api/v1/projects/${created.id}/verification-contract/revisions`,
        bearer(),
      );
      expect(history.status).toBe(200);
      expect(await history.json()).toMatchObject([
        { revision: 2, enabled: false },
        { revision: 1, enabled: true },
      ]);
    } finally {
      await fixture.close();
    }
  });

  test("rejects malformed Project inputs with the documented envelope", async () => {
    const fixture = await createFixture();
    try {
      const malformed = await fixture.app.request("/api/v1/projects", {
        method: "POST",
        headers: { ...bearer().headers, "Content-Type": "application/json" },
        body: "{",
      });
      expect(malformed.status).toBe(400);
      expect(await errorCode(malformed)).toBe("bad_request");

      const invalid = await fixture.app.request(
        "/api/v1/projects",
        jsonRequest("POST", { ...projectInput(fixture.repository), unexpected: true }),
      );
      expect(invalid.status).toBe(422);
      const body = (await invalid.json()) as { error: { details: { fields: unknown[] } } };
      expect(body.error.details.fields.length).toBeGreaterThan(0);

      const invalidId = await fixture.app.request("/api/v1/projects/not-an-id", bearer());
      expect(invalidId.status).toBe(422);
    } finally {
      await fixture.close();
    }
  });

  test("validates the two Project profile fields independently", async () => {
    const fixture = await createFixture();
    try {
      const createdResponse = await fixture.app.request(
        "/api/v1/projects",
        jsonRequest("POST", projectInput(fixture.repository)),
      );
      const project = (await createdResponse.json()) as { id: ProjectId };
      const profile = await fixture.agentProfiles.create({
        name: "Curator only",
        authMode: "api_key",
        credentialReference: "OPENAI_API_KEY",
        ...profileSelection(),
      });
      const curationOnly = await fixture.app.request(
        `/api/v1/projects/${project.id}`,
        jsonRequest("PATCH", { curationAgentProfileId: profile.id }),
      );
      expect(curationOnly.status).toBe(200);
      expect(await curationOnly.json()).toMatchObject({
        curationAgentProfileId: profile.id,
        implementationAgentProfileId: null,
        automationEnabled: false,
      });

      const missingImplementation = await fixture.app.request(
        `/api/v1/projects/${project.id}`,
        jsonRequest("PATCH", { automationEnabled: true }),
      );
      expect(missingImplementation.status).toBe(422);
      expect(await missingImplementation.json()).toMatchObject({
        error: {
          code: "validation_error",
          details: {
            fields: [
              {
                path: "implementationAgentProfileId",
                message: "Is required when automation is enabled.",
              },
            ],
          },
        },
      });

      const legacyAlias = await fixture.app.request(
        `/api/v1/projects/${project.id}`,
        jsonRequest("PATCH", { agentProfileId: profile.id }),
      );
      expect(legacyAlias.status).toBe(422);

      const disabled = await fixture.agentProfiles.create({
        name: "Disabled implementer",
        authMode: "api_key",
        credentialReference: "DISABLED_KEY",
        ...profileSelection(),
      });
      await fixture.agentProfiles.setEnabled(disabled.id, false);
      const disabledImplementation = await fixture.app.request(
        `/api/v1/projects/${project.id}`,
        jsonRequest("PATCH", {
          implementationAgentProfileId: disabled.id,
          automationEnabled: true,
        }),
      );
      expect(disabledImplementation.status).toBe(422);
      expect(await disabledImplementation.json()).toMatchObject({
        error: {
          details: {
            fields: [
              {
                path: "implementationAgentProfileId",
                message: "Agent Profile is unavailable.",
              },
            ],
          },
        },
      });
    } finally {
      await fixture.close();
    }
  });

  test("maps active Tasks to project_has_active_tasks on archive", async () => {
    const fixture = await createFixture();
    try {
      const response = await fixture.app.request(
        "/api/v1/projects",
        jsonRequest("POST", projectInput(fixture.repository)),
      );
      const project = (await response.json()) as { id: ProjectId };
      const task = createTask({
        id: fixture.ids.taskId(),
        projectId: project.id,
        userRequest: "Keep the Project active.",
        now: "2026-07-21T12:00:00.000Z",
      });
      await fixture.unitOfWork.execute((stores) => stores.tasks.insert(task));

      const archived = await fixture.app.request(`/api/v1/projects/${project.id}/archive`, {
        method: "POST",
        ...bearer(),
      });
      expect(archived.status).toBe(409);
      expect(await errorCode(archived)).toBe("project_has_active_tasks");
    } finally {
      await fixture.close();
    }
  });

  test("canonicalizes allowed repositories and rejects path, prefix and symlink escapes", async () => {
    const fixture = await createFixture();
    try {
      const nonGit = join(fixture.root, "not-git");
      await mkdir(nonGit);
      const siblingRoot = `${fixture.root}-outside`;
      await mkdir(siblingRoot);
      const outsideRepo = join(siblingRoot, "outside-repository");
      await initGit(outsideRepo);
      const escapeLink = join(fixture.root, "escape-link");
      await symlink(outsideRepo, escapeLink);

      for (const path of ["relative", nonGit, outsideRepo, escapeLink]) {
        const response = await fixture.app.request(
          "/api/v1/projects",
          jsonRequest("POST", projectInput(path)),
        );
        expect(response.status).toBe(422);
        expect(await errorCode(response)).toBe("validation_error");
      }
    } finally {
      await fixture.close();
    }
  });

  test("serves the authenticated OpenAPI document", async () => {
    const fixture = await createFixture();
    try {
      expect((await fixture.app.request("/api/v1/openapi.json")).status).toBe(401);
      const response = await fixture.app.request("/api/v1/openapi.json", bearer());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ openapi: "3.1.0", info: { version: "0.6.2" } });
    } finally {
      await fixture.close();
    }
  });
});

describe("Hito 8 Web serving", () => {
  test("serves the SPA entry and immutable assets without exposing API fallbacks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aiws-web-assets-"));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, "assets"));
    await Bun.write(join(directory, "index.html"), "<!doctype html><title>AIWS</title>");
    await Bun.write(join(directory, "assets", "app.js"), "console.log('aiws')");
    await Bun.write(join(directory, "aiws-logo.png"), new Uint8Array([137, 80, 78, 71]));
    const fixture = await createFixture({ webAssetsDirectory: directory });
    try {
      const route = await fixture.app.request("/tasks/example");
      expect(route.status).toBe(200);
      expect(route.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
      expect(await route.text()).toContain("AIWS");

      const loginRoute = await fixture.app.request("/login");
      expect(loginRoute.status).toBe(200);
      expect(await loginRoute.text()).toContain("AIWS");

      const asset = await fixture.app.request("/assets/app.js");
      expect(asset.status).toBe(200);
      expect(asset.headers.get("Cache-Control")).toContain("immutable");
      expect(asset.headers.get("Content-Type")).toContain("text/javascript");

      const logo = await fixture.app.request("/aiws-logo.png");
      expect(logo.status).toBe(200);
      expect(logo.headers.get("Content-Type")).toBe("image/png");
      expect(new Uint8Array(await logo.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));

      expect((await fixture.app.request("/api/v1/does-not-exist", bearer())).status).toBe(404);
    } finally {
      await fixture.close();
    }
  });
});

describe("Hito 4 Tasks and Activity", () => {
  test("creates an incremental Cycle through multipart messages and exposes its timeline", async () => {
    const fixture = await createFixture();
    try {
      const { task } = await createProjectAndTask(fixture, "Initial request");
      const createdTaskId = task.body.id as TaskId;
      let aggregate = await fixture.tasks.update({
        taskId: createdTaskId,
        expectedVersion: 1,
        changes: { curatorSpec: "# Implementable spec" },
        actorType: "web",
      });
      for (const [from, to] of [
        ["draft", "curating"],
        ["curating", "ready"],
        ["ready", "implementing"],
        ["implementing", "done"],
      ] as const) {
        aggregate = await fixture.tasks.transition({
          taskId: aggregate.id,
          expectedVersion: aggregate.version,
          from,
          to,
          actorType: "web",
        });
      }
      const form = new FormData();
      form.set("text", "Preserve one more exported field.");
      form.append("file", new File(["context\n"], "context.txt", { type: "text/plain" }));
      const response = await fixture.app.request(`/api/v1/tasks/${aggregate.id}/messages`, {
        method: "POST",
        headers: { ...bearer().headers, "If-Match": `"${aggregate.version}"` },
        body: form,
      });
      expect(response.status).toBe(201);
      const createdMessage = (await response.json()) as {
        message: { id: string; type: string; text: string | null };
        taskVersion: number;
      };
      expect(createdMessage).toMatchObject({
        message: { type: "change", text: "Preserve one more exported field." },
        taskVersion: aggregate.version + 1,
      });
      const updated = await fixture.tasks.get(aggregate.id);
      expect(updated).toMatchObject({ status: "curating", currentCycle: { number: 2 } });
      expect(updated.attachments).toEqual([
        expect.objectContaining({ messageId: createdMessage.message.id }),
      ]);

      const timeline = await fixture.app.request(
        `/api/v1/tasks/${aggregate.id}/timeline?limit=100`,
        bearer(),
      );
      expect(timeline.status).toBe(200);
      const page = (await timeline.json()) as {
        items: { kind: string; type?: string; text?: string }[];
      };
      expect(page.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "message", type: "initial_request" }),
          expect.objectContaining({
            kind: "message",
            type: "change",
            text: "Preserve one more exported field.",
          }),
        ]),
      );
    } finally {
      await fixture.close();
    }
  });

  test("creates, lists and shows the documented aggregate with ETag", async () => {
    const fixture = await createFixture();
    try {
      const { project, task } = await createProjectAndTask(fixture, "Original request\nDetails");
      expect(task.response.status).toBe(201);
      expect(task.response.headers.get("ETag")).toBe('"1"');
      expect(task.body).toMatchObject({
        project: { id: project.id },
        userRequest: "Original request\nDetails",
        title: "Original request",
        curatorSpec: "",
        status: "draft",
        version: 1,
        questions: [],
        attachments: [],
        specRevisions: [],
      });

      const questionId = fixture.ids.questionId();
      const optionA = fixture.ids.optionId();
      const optionB = fixture.ids.optionId();
      const attachmentId = fixture.ids.attachmentId();
      fixture.database
        .query(
          `INSERT INTO questions(
             id, task_id, text, type, options_json, allow_other,
             selected_option_ids_json, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          questionId,
          task.body.id,
          "Where?",
          "single_choice",
          JSON.stringify([
            { id: optionA, label: "Here", position: 0 },
            { id: optionB, label: "There", position: 1 },
          ]),
          0,
          "[]",
          "open",
          "2026-07-21T12:00:00.000Z",
          "2026-07-21T12:00:00.000Z",
        );
      fixture.database
        .query(
          `INSERT INTO attachments(
             id, task_id, original_name, storage_key, mime_type, size_bytes, sha256, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          attachmentId,
          task.body.id,
          "log.txt",
          `attachments/${task.body.id}/${attachmentId}`,
          "text/plain",
          3,
          "a".repeat(64),
          "2026-07-21T12:00:00.000Z",
        );

      const shown = await fixture.app.request(`/api/v1/tasks/${task.body.id}`, bearer());
      expect(shown.status).toBe(200);
      expect(shown.headers.get("ETag")).toBe('"1"');
      const aggregate = (await shown.json()) as {
        questions: { id: string; options: unknown[] }[];
        attachments: { id: string; downloadUrl: string }[];
        specRevisions: unknown[];
      };
      expect(aggregate.questions).toEqual([
        expect.objectContaining({ id: questionId, options: expect.any(Array) }),
      ]);
      expect(aggregate.attachments).toEqual([
        expect.objectContaining({
          id: attachmentId,
          downloadUrl: `/api/v1/tasks/${task.body.id}/attachments/${attachmentId}/content`,
        }),
      ]);
      expect(aggregate.specRevisions).toEqual([]);

      const listed = await fixture.app.request(
        `/api/v1/tasks?projectId=${project.id}&status=draft&status=ready&sort=createdAt&order=asc`,
        bearer(),
      );
      expect(listed.status).toBe(200);
      const page = (await listed.json()) as { items: Record<string, unknown>[]; nextCursor: null };
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        id: task.body.id,
        projectId: project.id,
        projectName: "AIWS",
        status: "draft",
        version: 1,
      });
      expect(page.items[0]).not.toHaveProperty("userRequest");
      expect(page.items[0]).not.toHaveProperty("curatorSpec");
    } finally {
      await fixture.close();
    }
  });

  test("enforces If-Match and allows exactly one concurrent claim", async () => {
    const fixture = await createFixture();
    try {
      const { task } = await createProjectAndTask(fixture, "Claim me");
      const missing = await fixture.app.request(`/api/v1/tasks/${task.body.id}`, {
        method: "PATCH",
        headers: { ...bearer().headers, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "No version" }),
      });
      expect(missing.status).toBe(428);
      expect(await errorCode(missing)).toBe("expected_version_required");

      const invalid = await fixture.app.request(
        `/api/v1/tasks/${task.body.id}`,
        taskMutation("PATCH", "bad", { title: "Bad header" }),
      );
      expect(invalid.status).toBe(422);

      const specified = await fixture.app.request(
        `/api/v1/tasks/${task.body.id}`,
        taskMutation("PATCH", 1, { curatorSpec: "# Implementation" }),
      );
      expect(specified.status).toBe(200);
      expect(specified.headers.get("ETag")).toBe('"2"');

      const curating = await fixture.app.request(
        `/api/v1/tasks/${task.body.id}/transition`,
        taskMutation("POST", 2, { from: "draft", to: "curating", reason: "Submitted" }),
      );
      expect(curating.status).toBe(200);
      expect(curating.headers.get("ETag")).toBe('"3"');

      const mismatch = await fixture.app.request(
        `/api/v1/tasks/${task.body.id}`,
        taskMutation("PATCH", 2, { title: "Lost update" }),
      );
      expect(mismatch.status).toBe(409);
      expect(await errorCode(mismatch)).toBe("version_conflict");

      const ready = await fixture.app.request(
        `/api/v1/tasks/${task.body.id}/transition`,
        taskMutation("POST", 3, { from: "curating", to: "ready", reason: "Curated" }),
      );
      expect(ready.status).toBe(200);
      expect(ready.headers.get("ETag")).toBe('"4"');

      const claims = await Promise.all([
        fixture.app.request(
          `/api/v1/tasks/${task.body.id}/transition`,
          taskMutation("POST", 4, { from: "ready", to: "implementing" }),
        ),
        fixture.app.request(
          `/api/v1/tasks/${task.body.id}/transition`,
          taskMutation("POST", 4, { from: "ready", to: "implementing" }),
        ),
      ]);
      expect(claims.map((response) => response.status).sort()).toEqual([200, 409]);
      const winner = claims.find((response) => response.status === 200) as Response;
      expect(winner.headers.get("ETag")).toBe('"5"');

      const shown = await fixture.app.request(`/api/v1/tasks/${task.body.id}`, bearer());
      expect(await shown.json()).toMatchObject({ status: "implementing", version: 5 });
      const activity = await fixture.app.request(
        `/api/v1/tasks/${task.body.id}/activity?limit=2`,
        bearer(),
      );
      expect(activity.status).toBe(200);
      const firstPage = (await activity.json()) as {
        items: Record<string, unknown>[];
        nextCursor: string;
      };
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.nextCursor).toBeString();
      expect(firstPage.items[0]).toMatchObject({
        type: "status_changed",
        actorType: "cli",
        metadata: { taskVersion: 5, from: "ready", to: "implementing" },
      });
      const secondPage = await fixture.app.request(
        `/api/v1/tasks/${task.body.id}/activity?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
        bearer(),
      );
      expect(secondPage.status).toBe(200);
      expect(((await secondPage.json()) as { items: unknown[] }).items).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  });

  test("edits userRequest only while the Task remains Draft", async () => {
    const fixture = await createFixture();
    try {
      const { task } = await createProjectAndTask(fixture, "Original request");
      const edited = await fixture.app.request(
        `/api/v1/tasks/${task.body.id}`,
        taskMutation("PATCH", 1, { userRequest: "Final requester wording" }),
      );
      expect(edited.status).toBe(200);
      expect(await edited.json()).toMatchObject({
        userRequest: "Final requester wording",
        version: 2,
      });
      const submitted = await fixture.app.request(
        `/api/v1/tasks/${task.body.id}/transition`,
        taskMutation("POST", 2, { from: "draft", to: "curating" }),
      );
      expect(submitted.status).toBe(200);
      const frozen = await fixture.app.request(
        `/api/v1/tasks/${task.body.id}`,
        taskMutation("PATCH", 3, { userRequest: "Late rewrite" }),
      );
      expect(frozen.status).toBe(422);
      const shown = await fixture.app.request(`/api/v1/tasks/${task.body.id}`, bearer());
      expect(await shown.json()).toMatchObject({
        userRequest: "Final requester wording",
        status: "curating",
        version: 3,
      });
    } finally {
      await fixture.close();
    }
  });

  test("archives and restores without physical deletion", async () => {
    const fixture = await createFixture();
    try {
      const { task } = await createProjectAndTask(fixture, "Archive me");
      const archived = await fixture.app.request(
        `/api/v1/tasks/${task.body.id}/archive`,
        taskMutation("POST", 1, { reason: "Duplicate" }),
      );
      expect(archived.status).toBe(200);
      expect(archived.headers.get("ETag")).toBe('"2"');
      expect(await archived.json()).toMatchObject({ version: 2, archivedAt: expect.any(String) });

      const readOnly = await fixture.app.request(
        `/api/v1/tasks/${task.body.id}`,
        taskMutation("PATCH", 2, { title: "Forbidden" }),
      );
      expect(readOnly.status).toBe(409);
      expect(await errorCode(readOnly)).toBe("invalid_transition");

      const activeList = await fixture.app.request("/api/v1/tasks", bearer());
      expect(((await activeList.json()) as { items: unknown[] }).items).toHaveLength(0);
      const archiveList = await fixture.app.request("/api/v1/tasks?archived=true", bearer());
      expect(((await archiveList.json()) as { items: unknown[] }).items).toHaveLength(1);

      const restored = await fixture.app.request(`/api/v1/tasks/${task.body.id}/unarchive`, {
        method: "POST",
        headers: { ...bearer().headers, "If-Match": '"2"' },
      });
      expect(restored.status).toBe(200);
      expect(restored.headers.get("ETag")).toBe('"3"');
      expect(await restored.json()).toMatchObject({ version: 3, archivedAt: null });
    } finally {
      await fixture.close();
    }
  });

  test("returns documented validation, not-found and transition errors", async () => {
    const fixture = await createFixture();
    try {
      const invalid = await fixture.app.request(
        "/api/v1/tasks",
        jsonRequest("POST", { projectId: "invalid", userRequest: "" }),
      );
      expect(invalid.status).toBe(422);
      expect(await errorCode(invalid)).toBe("validation_error");

      const missingId = "tsk_00000000000000000000000000";
      const missing = await fixture.app.request(`/api/v1/tasks/${missingId}`, bearer());
      expect(missing.status).toBe(404);
      expect(await errorCode(missing)).toBe("not_found");
      const missingActivity = await fixture.app.request(
        `/api/v1/tasks/${missingId}/activity`,
        bearer(),
      );
      expect(missingActivity.status).toBe(404);

      const { task } = await createProjectAndTask(fixture, "Not ready yet");
      const notReady = await fixture.app.request(
        `/api/v1/tasks/${task.body.id}/transition`,
        taskMutation("POST", 1, { from: "draft", to: "ready" }),
      );
      expect(notReady.status).toBe(409);
      expect(await errorCode(notReady)).toBe("invalid_transition");
      const unchanged = await fixture.app.request(`/api/v1/tasks/${task.body.id}`, bearer());
      expect(await unchanged.json()).toMatchObject({ status: "draft", version: 1 });
    } finally {
      await fixture.close();
    }
  });
});

describe("Hito 5 Questions", () => {
  test("implements create, list, show, update, answer, reopen and dismiss", async () => {
    const fixture = await createFixture();
    try {
      const { task } = await createProjectAndTask(fixture, "Question workflow");
      const path = `/api/v1/tasks/${task.body.id}/questions`;

      const missingVersion = await fixture.app.request(
        path,
        jsonRequest("POST", {
          text: "Where?",
          type: "text",
          options: [],
          allowOther: false,
        }),
      );
      expect(missingVersion.status).toBe(428);

      const curating = await fixture.app.request(
        `/api/v1/tasks/${task.body.id}/transition`,
        taskMutation("POST", 1, { from: "draft", to: "curating" }),
      );
      expect(curating.status).toBe(200);

      const invalid = await fixture.app.request(
        path,
        taskMutation("POST", 2, {
          text: "Where?",
          type: "single_choice",
          options: [{ label: "Only one" }],
          allowOther: false,
        }),
      );
      expect(invalid.status).toBe(422);

      const created = await fixture.app.request(
        path,
        taskMutation("POST", 2, {
          text: "Where does it fail?",
          type: "single_choice",
          options: [{ label: "Production" }, { label: "Test" }],
          allowOther: true,
        }),
      );
      expect(created.status).toBe(201);
      expect(created.headers.get("ETag")).toBe('"3"');
      const createdBody = (await created.json()) as {
        status: string;
        version: number;
        questions: { id: string; options: { id: string; position: number }[] }[];
      };
      expect(createdBody).toMatchObject({ status: "blocked", version: 3 });
      const original = createdBody.questions[0] as (typeof createdBody.questions)[number];
      expect(original.options.map((option) => option.position)).toEqual([0, 1]);

      const list = await fixture.app.request(path, bearer());
      expect(list.status).toBe(200);
      expect((await list.json()) as unknown[]).toHaveLength(1);
      const shown = await fixture.app.request(`${path}/${original.id}`, bearer());
      expect(shown.status).toBe(200);
      expect(await shown.json()).toMatchObject({ id: original.id, status: "open" });

      const updated = await fixture.app.request(
        `${path}/${original.id}`,
        taskMutation("PATCH", 3, {
          text: "Choose environments",
          type: "multiple_choice",
          options: [{ label: "Production" }, { label: "Test" }],
          allowOther: false,
        }),
      );
      expect(updated.status).toBe(200);
      expect(updated.headers.get("ETag")).toBe('"4"');
      const updatedBody = (await updated.json()) as {
        questions: { id: string; options: { id: string }[] }[];
      };
      const definition = updatedBody.questions[0] as (typeof updatedBody.questions)[number];
      expect(definition.options.map((option) => option.id)).not.toEqual(
        original.options.map((option) => option.id),
      );

      const invalidAnswer = await fixture.app.request(
        `${path}/${original.id}/answer`,
        taskMutation("POST", 4, {
          selectedOptionIds: ["opt_00000000000000000000000000"],
          answerText: null,
        }),
      );
      expect(invalidAnswer.status).toBe(422);
      const unchanged = await fixture.app.request(`/api/v1/tasks/${task.body.id}`, bearer());
      expect(await unchanged.json()).toMatchObject({ status: "blocked", version: 4 });

      const answered = await fixture.app.request(
        `${path}/${original.id}/answer`,
        taskMutation("POST", 4, {
          selectedOptionIds: definition.options.map((option) => option.id),
          answerText: "Sensitive answer",
        }),
      );
      expect(answered.status).toBe(200);
      expect(await answered.json()).toMatchObject({ status: "curating", version: 5 });

      const frozen = await fixture.app.request(
        `${path}/${original.id}`,
        taskMutation("PATCH", 5, {
          text: "Cannot edit",
          type: "text",
          options: [],
          allowOther: false,
        }),
      );
      expect(frozen.status).toBe(409);

      const reopened = await fixture.app.request(
        `${path}/${original.id}/reopen`,
        taskMutation("POST", 5, { reason: "Needs review" }),
      );
      expect(reopened.status).toBe(200);
      expect(await reopened.json()).toMatchObject({ status: "blocked", version: 6 });

      const dismissed = await fixture.app.request(
        `${path}/${original.id}/dismiss`,
        taskMutation("POST", 6, { reason: "No longer relevant" }),
      );
      expect(dismissed.status).toBe(200);
      expect(dismissed.headers.get("ETag")).toBe('"7"');
      expect(await dismissed.json()).toMatchObject({ status: "curating", version: 7 });

      const wrongTask = await fixture.app.request(
        `/api/v1/tasks/tsk_00000000000000000000000000/questions/${original.id}`,
        bearer(),
      );
      expect(wrongTask.status).toBe(404);

      const activity = await fixture.app.request(
        `/api/v1/tasks/${task.body.id}/activity?limit=50`,
        bearer(),
      );
      const activityBody = (await activity.json()) as { items: Record<string, unknown>[] };
      expect(activityBody.items.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          "question_created",
          "question_updated",
          "question_answered",
          "question_reopened",
          "question_dismissed",
          "status_changed",
        ]),
      );
      expect(JSON.stringify(activityBody)).not.toContain("Sensitive answer");
    } finally {
      await fixture.close();
    }
  });

  test("Done rejects Question creation and version conflicts leave no partial rows", async () => {
    const fixture = await createFixture();
    try {
      const { task } = await createProjectAndTask(fixture, "Done task");
      await fixture.app.request(
        `/api/v1/tasks/${task.body.id}`,
        taskMutation("PATCH", 1, { curatorSpec: "# Spec" }),
      );
      await fixture.app.request(
        `/api/v1/tasks/${task.body.id}/transition`,
        taskMutation("POST", 2, { from: "draft", to: "curating" }),
      );
      await fixture.app.request(
        `/api/v1/tasks/${task.body.id}/transition`,
        taskMutation("POST", 3, { from: "curating", to: "ready" }),
      );
      await fixture.app.request(
        `/api/v1/tasks/${task.body.id}/transition`,
        taskMutation("POST", 4, { from: "ready", to: "implementing" }),
      );
      await fixture.app.request(
        `/api/v1/tasks/${task.body.id}/transition`,
        taskMutation("POST", 5, { from: "implementing", to: "done" }),
      );
      const path = `/api/v1/tasks/${task.body.id}/questions`;
      const done = await fixture.app.request(
        path,
        taskMutation("POST", 6, {
          text: "Forbidden",
          type: "text",
          options: [],
          allowOther: false,
        }),
      );
      expect(done.status).toBe(409);

      const stale = await fixture.app.request(
        path,
        taskMutation("POST", 5, {
          text: "Stale",
          type: "text",
          options: [],
          allowOther: false,
        }),
      );
      expect(stale.status).toBe(409);
      expect(await errorCode(stale)).toBe("version_conflict");
      const list = await fixture.app.request(path, bearer());
      expect(await list.json()).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
});

describe("Hito 6 Attachments", () => {
  test("uploads, lists, gets, downloads and deletes an authenticated attachment", async () => {
    const fixture = await createFixture();
    try {
      const { task } = await createProjectAndTask(fixture, "Attachment API");
      const path = `/api/v1/tasks/${task.body.id}/attachments`;
      const content = "first line\nsecond line\n";

      const missingVersionForm = new FormData();
      missingVersionForm.set("file", new File([content], "run.log", { type: "text/plain" }));
      const missingVersion = await fixture.app.request(path, {
        method: "POST",
        headers: bearer().headers,
        body: missingVersionForm,
      });
      expect(missingVersion.status).toBe(428);

      const form = new FormData();
      form.set("file", new File([content], "run.log", { type: "text/plain" }));
      const uploaded = await fixture.app.request(path, {
        method: "POST",
        headers: { ...bearer().headers, "If-Match": '"1"' },
        body: form,
      });
      expect(uploaded.status).toBe(201);
      expect(uploaded.headers.get("ETag")).toBe('"2"');
      const body = (await uploaded.json()) as {
        attachment: {
          id: string;
          originalName: string;
          mimeType: string;
          sizeBytes: number;
          sha256: string;
          downloadUrl: string;
        };
        taskVersion: number;
      };
      expect(body).toMatchObject({
        attachment: {
          originalName: "run.log",
          mimeType: "text/plain",
          sizeBytes: new TextEncoder().encode(content).byteLength,
        },
        taskVersion: 2,
      });
      expect(body.attachment.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(body.attachment).not.toHaveProperty("storageKey");

      const listed = await fixture.app.request(path, bearer());
      expect(await listed.json()).toEqual([body.attachment]);
      const metadata = await fixture.app.request(`${path}/${body.attachment.id}`, bearer());
      expect(await metadata.json()).toEqual(body.attachment);

      const downloaded = await fixture.app.request(body.attachment.downloadUrl, bearer());
      expect(downloaded.status).toBe(200);
      expect(downloaded.headers.get("Content-Type")).toStartWith("text/plain");
      expect(downloaded.headers.get("Content-Length")).toBe(String(body.attachment.sizeBytes));
      expect(downloaded.headers.get("Content-Disposition")).toBe(
        "attachment; filename*=UTF-8''run.log",
      );
      expect(downloaded.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(downloaded.headers.get("ETag")).toBe(`"${body.attachment.sha256}"`);
      expect(await downloaded.text()).toBe(content);

      const staleDelete = await fixture.app.request(`${path}/${body.attachment.id}`, {
        method: "DELETE",
        headers: { ...bearer().headers, "If-Match": '"1"' },
      });
      expect(staleDelete.status).toBe(409);

      const removed = await fixture.app.request(`${path}/${body.attachment.id}`, {
        method: "DELETE",
        headers: { ...bearer().headers, "If-Match": '"2"' },
      });
      expect(removed.status).toBe(200);
      expect(removed.headers.get("ETag")).toBe('"3"');
      expect(await removed.json()).toEqual({ taskVersion: 3 });
      expect((await fixture.app.request(body.attachment.downloadUrl, bearer())).status).toBe(404);
    } finally {
      await fixture.close();
    }
  });

  test("returns contract errors for malformed, unsupported, oversized and over-limit uploads", async () => {
    const fixture = await createFixture({
      maximumAttachmentsPerTask: 1,
      maximumAttachmentBytes: 4,
    });
    try {
      const { task } = await createProjectAndTask(fixture, "Attachment errors");
      const path = `/api/v1/tasks/${task.body.id}/attachments`;
      const malformed = await fixture.app.request(path, {
        method: "POST",
        headers: {
          ...bearer().headers,
          "If-Match": '"1"',
          "Content-Type": "multipart/form-data; boundary=x",
        },
        body: "not multipart",
      });
      expect(malformed.status).toBe(400);
      expect(await errorCode(malformed)).toBe("bad_request");

      const unsupportedForm = new FormData();
      unsupportedForm.set("file", new File(["<svg/>"], "bad.svg", { type: "image/svg+xml" }));
      const unsupported = await fixture.app.request(path, {
        method: "POST",
        headers: { ...bearer().headers, "If-Match": '"1"' },
        body: unsupportedForm,
      });
      expect(unsupported.status).toBe(415);
      expect(await errorCode(unsupported)).toBe("unsupported_media_type");

      const largeForm = new FormData();
      largeForm.set("file", new File(["12345"], "large.txt", { type: "text/plain" }));
      const large = await fixture.app.request(path, {
        method: "POST",
        headers: { ...bearer().headers, "If-Match": '"1"' },
        body: largeForm,
      });
      expect(large.status).toBe(413);
      expect(await errorCode(large)).toBe("attachment_too_large");

      const firstForm = new FormData();
      firstForm.set("file", new File(["one"], "one.txt", { type: "text/plain" }));
      expect(
        (
          await fixture.app.request(path, {
            method: "POST",
            headers: { ...bearer().headers, "If-Match": '"1"' },
            body: firstForm,
          })
        ).status,
      ).toBe(201);
      const secondForm = new FormData();
      secondForm.set("file", new File(["two"], "two.txt", { type: "text/plain" }));
      const limited = await fixture.app.request(path, {
        method: "POST",
        headers: { ...bearer().headers, "If-Match": '"2"' },
        body: secondForm,
      });
      expect(limited.status).toBe(422);
      expect(await errorCode(limited)).toBe("attachment_limit_reached");
    } finally {
      await fixture.close();
    }
  });
});

class MemoryLogger implements Logger {
  readonly entries: LogEntry[] = [];
  log(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

async function createFixture(
  overrides: {
    loginAttempts?: number;
    logger?: Logger;
    production?: boolean;
    publicUrl?: string;
    maximumAttachmentsPerTask?: number;
    maximumAttachmentBytes?: number;
    webAssetsDirectory?: string;
    healthCheck?: () => boolean | Promise<boolean>;
    modelCatalog?: {
      list: () => Promise<ReturnType<typeof profileSelection>["catalog"]>;
    } | null;
    projectReadiness?: {
      check: (
        projectId: ProjectId,
        depth: "standard" | "deep",
      ) => Promise<{
        projectId: ProjectId;
        depth: "standard" | "deep";
        checkedAt: string;
        durationMs: number;
        ok: boolean;
        checks: readonly {
          id: string;
          status: "pass" | "warning" | "fail" | "skipped";
          message: string;
          details: Readonly<Record<string, string | number | boolean | null>>;
        }[];
      }>;
    };
    metrics?: Pick<ProductMetricsService, "project">;
    runnerActivity?: RunnerActivityMonitor;
    github?: GitHubAppGateway;
    notificationSettings?: {
      get: () => {
        enabled: boolean;
        baseUrl: string;
        topic: string;
        accessTokenConfigured: boolean;
        updatedAt: string;
      };
      update: (patch: {
        enabled?: boolean;
        baseUrl?: string;
        topic?: string;
        accessToken?: string | null;
      }) => Promise<{
        enabled: boolean;
        baseUrl: string;
        topic: string;
        accessTokenConfigured: boolean;
        updatedAt: string;
      }>;
      test: () => Promise<void>;
    };
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "aiws-server-h3-"));
  temporaryDirectories.push(directory);
  const root = join(directory, "repos");
  const repository = join(root, "repository");
  await mkdir(root);
  await initGit(repository);
  const database = openDatabase({ path: join(directory, "aiws.sqlite") });
  const unitOfWork = new SqliteUnitOfWork(database);
  const clock = new SystemClock();
  const ids = new UlidIdGenerator(clock);
  const projects = new ProjectUseCases(unitOfWork, { clock, ids });
  const tasks = new TaskUseCases(unitOfWork, { clock, ids });
  const questions = new QuestionUseCases(unitOfWork, { clock, ids });
  const blobStore = await FileAttachmentBlobStore.create(directory);
  const attachments = new AttachmentUseCases(
    unitOfWork,
    blobStore,
    { clock, ids },
    {
      maximumAttachmentsPerTask: overrides.maximumAttachmentsPerTask ?? 10,
      maximumAttachmentBytes: overrides.maximumAttachmentBytes ?? 26_214_400,
    },
  );
  const connections = new ConnectionUseCases(unitOfWork, { clock, ids });
  const agentProfiles = new AgentProfileUseCases(unitOfWork, { clock, ids });
  const runs = new RunUseCases(unitOfWork, { clock, ids });
  const messages = new MessageUseCases(
    unitOfWork,
    blobStore,
    { clock, ids },
    {
      maximumAttachmentsPerTask: overrides.maximumAttachmentsPerTask ?? 10,
      maximumAttachmentBytes: overrides.maximumAttachmentBytes ?? 26_214_400,
    },
  );
  const verificationContracts = new VerificationContractUseCases(unitOfWork, { clock, ids });
  const repositoryValidator = await RepositoryValidator.create([root]);
  const app = createApp({
    projects,
    tasks,
    questions,
    attachments,
    connections,
    agentProfiles,
    runs,
    messages,
    verificationContracts,
    repositoryValidator,
    openApiDocument: { openapi: "3.1.0", info: { version: "0.6.2" } },
    healthCheck: overrides.healthCheck ?? (() => true),
    logger: overrides.logger ?? new MemoryLogger(),
    publicUrl: overrides.publicUrl ?? "http://localhost:3000",
    adminUsername: "admin",
    adminPasswordHash: passwordHash,
    sessionSecret,
    apiTokenHash: `sha256:${new Bun.CryptoHasher("sha256").update(token).digest("hex")}`,
    runnerTokenHash: `sha256:${new Bun.CryptoHasher("sha256").update(runnerToken).digest("hex")}`,
    ...(overrides.github === undefined ? {} : { github: overrides.github }),
    ...(overrides.runnerActivity === undefined ? {} : { runnerActivity: overrides.runnerActivity }),
    ...(overrides.notificationSettings === undefined
      ? {}
      : { notificationSettings: overrides.notificationSettings }),
    ...(overrides.modelCatalog === null
      ? {}
      : {
          modelCatalog: overrides.modelCatalog ?? {
            list: async () => profileSelection().catalog,
          },
        }),
    ...(overrides.projectReadiness === undefined
      ? {}
      : { projectReadiness: overrides.projectReadiness }),
    ...(overrides.metrics === undefined ? {} : { metrics: overrides.metrics }),
    repositoriesDir: join(directory, "managed-repositories"),
    runLogsDirectory: join(directory, "run-logs"),
    sessionTtlSeconds: 3600,
    loginAttempts: overrides.loginAttempts ?? 5,
    loginWindowSeconds: 900,
    production: overrides.production ?? false,
    trustProxy: false,
    ...(overrides.webAssetsDirectory === undefined
      ? {}
      : { webAssetsDirectory: overrides.webAssetsDirectory }),
    now: () => new Date("2026-07-21T12:00:00.000Z"),
  });
  return {
    app,
    root,
    repository,
    database,
    ids,
    unitOfWork,
    blobStore,
    projects,
    tasks,
    connections,
    agentProfiles,
    runs,
    close: () => unitOfWork.close(),
  };
}

function githubWithBranches(names: readonly string[]): GitHubAppGateway {
  const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  return new GitHubAppGateway({
    appId: "1",
    appSlug: "aiws-test",
    privateKey,
    apiBaseUrl: "https://api.github.test",
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/access_tokens")) return Response.json({ token: "short-lived" });
      if (url.pathname === "/repos/acme/managed/branches") {
        return Response.json(
          names.map((name, index) => ({
            name,
            commit: { sha: String.fromCharCode(97 + index).repeat(40) },
            protected: index === 0,
          })),
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
}

async function initGit(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const process = Bun.spawn(["git", "init", "--quiet", directory], { stderr: "pipe" });
  if ((await process.exited) !== 0) throw new Error(await new Response(process.stderr).text());
}

function bearer(): { headers: Record<string, string> } {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { ...bearer().headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function taskMutation(method: string, version: number | string, body?: unknown): RequestInit {
  return {
    method,
    headers: {
      ...bearer().headers,
      "If-Match": typeof version === "number" ? `"${version}"` : version,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

async function createProjectAndTask(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  userRequest: string,
) {
  const projectResponse = await fixture.app.request(
    "/api/v1/projects",
    jsonRequest("POST", projectInput(fixture.repository)),
  );
  const project = (await projectResponse.json()) as { id: string };
  const response = await fixture.app.request(
    "/api/v1/tasks",
    jsonRequest("POST", { projectId: project.id, userRequest }),
  );
  const body = (await response.clone().json()) as { id: string; version: number };
  return { project, task: { response, body } };
}

function projectInput(repositoryPath: string) {
  return {
    name: "AIWS",
    description: "Test project",
    repositoryPath,
    gitProvider: "github",
    accountScope: "personal",
  };
}

async function login(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  username: string,
  password: string,
): Promise<Response> {
  return fixture.app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}
