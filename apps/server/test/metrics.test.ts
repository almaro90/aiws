import { afterEach, describe, expect, test } from "bun:test";
import { ProjectUseCases, SystemClock, TaskUseCases, UlidIdGenerator } from "@aiws/core";
import { openDatabase, SqliteUnitOfWork } from "@aiws/sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProductMetricsService } from "../src/metrics.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("local product metrics", () => {
  test("derives bounded metrics without mutating data and includes archived Projects", async () => {
    const directory = mkdtempSync(join(tmpdir(), "aiws-metrics-"));
    directories.push(directory);
    const database = openDatabase({ path: join(directory, "aiws.sqlite") });
    const unitOfWork = new SqliteUnitOfWork(database);
    const clock = new SystemClock();
    const ids = new UlidIdGenerator(clock);
    const projects = new ProjectUseCases(unitOfWork, { clock, ids });
    const tasks = new TaskUseCases(unitOfWork, { clock, ids });
    const project = await projects.create({
      name: "Metrics",
      repositoryPath: "/repos/metrics",
      gitProvider: "other",
      accountScope: "work",
    });
    const created = await tasks.create({
      projectId: project.id,
      userRequest: "Measure this flow",
      actorType: "cli",
    });
    const specified = await tasks.update({
      taskId: created.id,
      expectedVersion: created.version,
      changes: { curatorSpec: "# Accepted plan" },
      actorType: "cli",
    });
    const curating = await tasks.transition({
      taskId: created.id,
      expectedVersion: specified.version,
      from: "draft",
      to: "curating",
      actorType: "cli",
    });
    const ready = await tasks.transition({
      taskId: created.id,
      expectedVersion: curating.version,
      from: "curating",
      to: "ready",
      actorType: "cli",
    });
    const timestamp = "2026-07-26T12:00:00.000Z";
    const profileId = "agp_01K0ABCDEFGHJKMNPQRSTVWXYZ";
    const runId = "run_01K0ABCDEFGHJKMNPQRSTVWXYZ";
    const deliveryId = "dlv_01K0ABCDEFGHJKMNPQRSTVWXYZ";
    database
      .query(
        `INSERT INTO agent_profiles(
          id, name, runtime, auth_mode, credential_reference, model, enabled, created_at, updated_at
        ) VALUES (?, 'Metrics profile', 'codex', 'api_key', 'env:CODEX_API_KEY', 'gpt-test', 1, ?, ?)`,
      )
      .run(profileId, timestamp, timestamp);
    database
      .query(
        `INSERT INTO runs(
          id, task_id, project_id, agent_profile_id, kind, attempt, status, task_version,
          branch_name, base_sha, head_sha, started_at, finished_at, created_at, updated_at,
          cycle_id, execution_stage
        ) VALUES (?, ?, ?, ?, 'implementation', 2, 'succeeded', ?, 'aiws/metrics',
          'base', 'head', ?, ?, ?, ?, ?, 'agent')`,
      )
      .run(
        runId,
        created.id,
        project.id,
        profileId,
        ready.version,
        timestamp,
        timestamp,
        timestamp,
        timestamp,
        ready.currentCycle.id,
      );
    database
      .query(
        `INSERT INTO verification_results(
          run_id, position, name, executable, args_json, required, status, started_at,
          finished_at, duration_ms, exit_code, stdout_excerpt, stderr_excerpt,
          image_digest, toolchain_identity
        ) VALUES (?, 0, 'tests', 'bun', '["test"]', 1, 'passed', ?, ?, 1, 0, '', '',
          'sha256:test', 'bun:test')`,
      )
      .run(runId, timestamp, timestamp);
    database
      .query(
        "INSERT INTO run_provenance(run_id, schema_version, payload_json, created_at) VALUES (?, 1, '{}', ?)",
      )
      .run(runId, timestamp);
    database
      .query(
        `INSERT INTO deliveries(
          id, task_id, branch_name, base_branch, pr_url, created_at, updated_at, pr_state,
          checks_state, checks_passed, checks_failed, checks_pending, external_updated_at,
          last_synchronized_at
        ) VALUES (?, ?, 'aiws/metrics', 'main', 'https://example.invalid/pr/1', ?, ?, 'merged',
          'passed', 1, 0, 0, ?, ?)`,
      )
      .run(deliveryId, created.id, timestamp, timestamp, timestamp, timestamp);
    database
      .query("UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?")
      .run(timestamp, timestamp, project.id);

    const before = database
      .query<{ count: number }, []>("SELECT count(*) AS count FROM task_events")
      .get();
    const service = new ProductMetricsService(database, () => new Date("2026-07-26T13:00:00.000Z"));
    const result = service.project(
      project.id,
      "2026-01-01T00:00:00.000Z",
      "2027-01-01T00:00:00.000Z",
    );
    const after = database
      .query<{ count: number }, []>("SELECT count(*) AS count FROM task_events")
      .get();

    expect(result.coverage).toMatchObject({
      tasks: 1,
      readySamples: 1,
      runs: 1,
      runsWithProvenance: 1,
      deliveries: 1,
      deliveriesObserved: 1,
      staleDeliveries: 0,
    });
    expect(result.runs.implementation).toMatchObject({ count: 1, completedSamples: 1 });
    expect(result.retries.full).toBe(1);
    expect(result.verification).toEqual({ passed: 1, failed: 0, requiredFailed: 0 });
    expect(result.delivery).toEqual({ pullRequests: 1, mergedObserved: 1 });
    expect(after).toEqual(before);
    expect(
      service.project(project.id, "2025-01-01T00:00:00.000Z", "2025-02-01T00:00:00.000Z").coverage
        .tasks,
    ).toBe(0);
    expect(() =>
      service.project(project.id, "2025-01-01T00:00:00.000Z", "2027-01-02T00:00:00.000Z"),
    ).toThrow("cannot exceed 366 days");
    await unitOfWork.close();
  });
});
