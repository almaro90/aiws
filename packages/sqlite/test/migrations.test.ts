import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MigrationError, openDatabase, runMigrations } from "../src/index.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "aiws-sqlite-"));
  temporaryDirectories.push(directory);
  return directory;
}

function openTemporaryDatabase(): Database {
  return openDatabase({
    path: join(temporaryDirectory(), "aiws.sqlite"),
    now: () => "2026-07-21T10:00:00.000Z",
  });
}

describe("SQLite migration contract", () => {
  test("keeps the packaged initial migration identical to the SQL contract", () => {
    const contract = readFileSync(
      join(import.meta.dir, "../../../docs/database/0001_initial.sql"),
      "utf8",
    );
    const packaged = readFileSync(join(import.meta.dir, "../migrations/0001_initial.sql"), "utf8");
    expect(packaged.trimEnd()).toBe(contract.trimEnd());
  });

  test("keeps the managed automation migration identical to the SQL contract", () => {
    const contract = readFileSync(
      join(import.meta.dir, "../../../docs/database/0002_managed_automation.sql"),
      "utf8",
    );
    const packaged = readFileSync(
      join(import.meta.dir, "../migrations/0002_managed_automation.sql"),
      "utf8",
    );
    expect(packaged.trimEnd()).toBe(contract.trimEnd());
  });

  test("keeps the managed curation migration identical to the SQL contract", () => {
    const contract = readFileSync(
      join(import.meta.dir, "../../../docs/database/0003_managed_curation.sql"),
      "utf8",
    );
    const packaged = readFileSync(
      join(import.meta.dir, "../migrations/0003_managed_curation.sql"),
      "utf8",
    );
    expect(packaged.trimEnd()).toBe(contract.trimEnd());
  });

  test("keeps the Run recovery migration identical to the SQL contract", () => {
    const contract = readFileSync(
      join(import.meta.dir, "../../../docs/database/0005_run_recovery.sql"),
      "utf8",
    );
    const packaged = readFileSync(
      join(import.meta.dir, "../migrations/0005_run_recovery.sql"),
      "utf8",
    );
    expect(packaged.trimEnd()).toBe(contract.trimEnd());
  });

  test("keeps the model catalog migration identical to the SQL contract", () => {
    const contract = readFileSync(
      join(import.meta.dir, "../../../docs/database/0006_agent_model_catalog.sql"),
      "utf8",
    );
    const packaged = readFileSync(
      join(import.meta.dir, "../migrations/0006_agent_model_catalog.sql"),
      "utf8",
    );
    expect(packaged.trimEnd()).toBe(contract.trimEnd());
  });

  test("keeps the global notifications migration identical to the SQL contract", () => {
    const contract = readFileSync(
      join(import.meta.dir, "../../../docs/database/0007_global_notifications.sql"),
      "utf8",
    );
    const packaged = readFileSync(
      join(import.meta.dir, "../migrations/0007_global_notifications.sql"),
      "utf8",
    );
    expect(packaged.trimEnd()).toBe(contract.trimEnd());
  });

  test("keeps the separate Agent Profiles migration identical to the SQL contract", () => {
    const contract = readFileSync(
      join(import.meta.dir, "../../../docs/database/0008_separate_agent_profiles.sql"),
      "utf8",
    );
    const packaged = readFileSync(
      join(import.meta.dir, "../migrations/0008_separate_agent_profiles.sql"),
      "utf8",
    );
    expect(packaged.trimEnd()).toBe(contract.trimEnd());
  });

  test("keeps the Delivery Base Branch migration identical to the SQL contract", () => {
    const contract = readFileSync(
      join(import.meta.dir, "../../../docs/database/0009_delivery_base_branch.sql"),
      "utf8",
    );
    const packaged = readFileSync(
      join(import.meta.dir, "../migrations/0009_delivery_base_branch.sql"),
      "utf8",
    );
    expect(packaged.trimEnd()).toBe(contract.trimEnd());
  });

  test("keeps the Azure DevOps provider migration identical to the SQL contract", () => {
    const contract = readFileSync(
      join(import.meta.dir, "../../../docs/database/0010_azure_devops_provider.sql"),
      "utf8",
    );
    const packaged = readFileSync(
      join(import.meta.dir, "../migrations/0010_azure_devops_provider.sql"),
      "utf8",
    );
    expect(packaged.trimEnd()).toBe(contract.trimEnd());
  });

  test("keeps the Ready approval migration identical to the SQL contract", () => {
    const contract = readFileSync(
      join(import.meta.dir, "../../../docs/database/0011_ready_approval_policy.sql"),
      "utf8",
    );
    const packaged = readFileSync(
      join(import.meta.dir, "../migrations/0011_ready_approval_policy.sql"),
      "utf8",
    );
    expect(packaged.trimEnd()).toBe(contract.trimEnd());
  });

  test("keeps the Verification Contract migration identical to the SQL contract", () => {
    const contract = readFileSync(
      join(import.meta.dir, "../../../docs/database/0012_verification_contract.sql"),
      "utf8",
    );
    const packaged = readFileSync(
      join(import.meta.dir, "../migrations/0012_verification_contract.sql"),
      "utf8",
    );
    expect(packaged.trimEnd()).toBe(contract.trimEnd());
  });

  test("keeps the Run evidence migration identical to the SQL contract", () => {
    const contract = readFileSync(
      join(import.meta.dir, "../../../docs/database/0013_run_evidence.sql"),
      "utf8",
    );
    const packaged = readFileSync(
      join(import.meta.dir, "../migrations/0013_run_evidence.sql"),
      "utf8",
    );
    expect(packaged.trimEnd()).toBe(contract.trimEnd());
  });

  test("keeps the Delivery Projection migration identical to the SQL contract", () => {
    const contract = readFileSync(
      join(import.meta.dir, "../../../docs/database/0014_delivery_projection.sql"),
      "utf8",
    );
    const packaged = readFileSync(
      join(import.meta.dir, "../migrations/0014_delivery_projection.sql"),
      "utf8",
    );
    expect(packaged.trimEnd()).toBe(contract.trimEnd());
  });

  test("migrates an empty database once and configures every required pragma", () => {
    const directory = temporaryDirectory();
    const path = join(directory, "aiws.sqlite");
    const database = openDatabase({ path, now: () => "2026-07-21T10:00:00.000Z" });

    expect(database.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()).toEqual({
      journal_mode: "wal",
    });
    expect(database.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1,
    });
    expect(database.query<{ timeout: number }, []>("PRAGMA busy_timeout").get()).toEqual({
      timeout: 5000,
    });
    expect(database.query<{ synchronous: number }, []>("PRAGMA synchronous").get()).toEqual({
      synchronous: 1,
    });
    expect(
      database
        .query<{ count: number }, []>("SELECT count(*) AS count FROM schema_migrations")
        .get(),
    ).toEqual({ count: 14 });
    database
      .query<void, [string, string, string, string, string]>(
        `INSERT INTO agent_profiles(
          id, name, runtime, auth_mode, credential_reference, created_at, updated_at
        ) VALUES (?, ?, 'codex', 'api_key', ?, ?, ?)`,
      )
      .run(
        "agp_00000000000000000000000001",
        "Legacy profile",
        "OPENAI_API_KEY",
        "2026-07-21T10:00:00.000Z",
        "2026-07-21T10:00:00.000Z",
      );
    expect(
      database
        .query<{ model: string | null; reasoning_effort: string | null }, []>(
          "SELECT model, reasoning_effort FROM agent_profiles",
        )
        .get(),
    ).toEqual({ model: null, reasoning_effort: null });
    database.close();

    const reopened = openDatabase({ path, now: () => "2099-01-01T00:00:00.000Z" });
    expect(
      reopened
        .query<{ count: number }, []>("SELECT count(*) AS count FROM schema_migrations")
        .get(),
    ).toEqual({ count: 14 });
    expect(
      reopened.query<{ applied_at: string }, []>("SELECT applied_at FROM schema_migrations").get(),
    ).toEqual({ applied_at: "2026-07-21T10:00:00.000Z" });
    reopened.close();
  });

  test("migrates an existing 0006 database to notification settings and the indexed outbox", () => {
    const directory = temporaryDirectory();
    const oldMigrations = join(directory, "old-migrations");
    mkdirSync(oldMigrations);
    for (const name of [
      "0001_initial.sql",
      "0002_managed_automation.sql",
      "0003_managed_curation.sql",
      "0004_task_cycles.sql",
      "0005_run_recovery.sql",
      "0006_agent_model_catalog.sql",
    ]) {
      copyFileSync(join(import.meta.dir, "../migrations", name), join(oldMigrations, name));
    }
    const path = join(directory, "aiws.sqlite");
    openDatabase({ path, migrationsDirectory: oldMigrations }).close();

    const migrated = openDatabase({ path });
    expect(
      migrated
        .query<{ count: number }, []>("SELECT count(*) AS count FROM schema_migrations")
        .get(),
    ).toEqual({ count: 14 });
    expect(
      migrated
        .query<{ enabled: number; base_url: string; topic: string }, []>(
          "SELECT enabled, base_url, topic FROM notification_settings",
        )
        .get(),
    ).toEqual({ enabled: 0, base_url: "https://ntfy.sh", topic: "" });
    expect(
      migrated
        .query<{ found: number }, []>(
          "SELECT count(*) AS found FROM sqlite_master WHERE type = 'index' AND name = 'idx_notification_outbox_due'",
        )
        .get(),
    ).toEqual({ found: 1 });
    migrated.close();
  });

  test("migrates a v0.5 Project profile to both phases without changing existing Runs", () => {
    const directory = temporaryDirectory();
    const oldMigrations = join(directory, "v05-migrations");
    mkdirSync(oldMigrations);
    for (const name of [
      "0001_initial.sql",
      "0002_managed_automation.sql",
      "0003_managed_curation.sql",
      "0004_task_cycles.sql",
      "0005_run_recovery.sql",
      "0006_agent_model_catalog.sql",
      "0007_global_notifications.sql",
    ]) {
      copyFileSync(join(import.meta.dir, "../migrations", name), join(oldMigrations, name));
    }
    const path = join(directory, "aiws.sqlite");
    const legacy = openDatabase({ path, migrationsDirectory: oldMigrations });
    const timestamp = "2026-07-24T10:00:00.000Z";
    const profileId = "agp_00000000000000000000000001";
    const projectId = "prj_00000000000000000000000001";
    const taskId = "tsk_00000000000000000000000001";
    const runId = "run_00000000000000000000000001";
    legacy
      .query(
        `INSERT INTO agent_profiles(
          id, name, runtime, auth_mode, credential_reference, enabled, created_at, updated_at
        ) VALUES (?, 'Legacy', 'codex', 'api_key', 'OPENAI_API_KEY', 1, ?, ?)`,
      )
      .run(profileId, timestamp, timestamp);
    legacy
      .query(
        `INSERT INTO projects(
          id, name, description, repository_path, git_provider, account_scope,
          repository_mode, automation_enabled, agent_profile_id, schedule_timezone,
          max_concurrency, created_at, updated_at
        ) VALUES (?, 'Legacy Project', '', '/repos/legacy', 'github', 'personal',
          'local', 1, ?, 'UTC', 1, ?, ?)`,
      )
      .run(projectId, profileId, timestamp, timestamp);
    legacy
      .query(
        `INSERT INTO tasks(
          id, project_id, title, user_request, status, version, created_at, updated_at
        ) VALUES (?, ?, 'Legacy Task', 'Keep history', 'curating', 1, ?, ?)`,
      )
      .run(taskId, projectId, timestamp, timestamp);
    legacy
      .query(
        `INSERT INTO runs(
          id, task_id, project_id, agent_profile_id, kind, attempt, status,
          task_version, execution_stage, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'curation', 1, 'failed', 1, 'agent', ?, ?)`,
      )
      .run(runId, taskId, projectId, profileId, timestamp, timestamp);
    legacy.close();

    const migrated = openDatabase({ path });
    expect(
      migrated
        .query<
          {
            curation_agent_profile_id: string | null;
            implementation_agent_profile_id: string | null;
          },
          []
        >("SELECT curation_agent_profile_id, implementation_agent_profile_id FROM projects")
        .get(),
    ).toEqual({
      curation_agent_profile_id: profileId,
      implementation_agent_profile_id: profileId,
    });
    expect(
      migrated
        .query<{ id: string; agent_profile_id: string }, []>(
          "SELECT id, agent_profile_id FROM runs",
        )
        .get(),
    ).toEqual({ id: runId, agent_profile_id: profileId });
    migrated.close();
  });

  test("backfills an existing Delivery from its Project default branch", () => {
    const directory = temporaryDirectory();
    const oldMigrations = join(directory, "pre-base-branch-migrations");
    mkdirSync(oldMigrations);
    for (const name of [
      "0001_initial.sql",
      "0002_managed_automation.sql",
      "0003_managed_curation.sql",
      "0004_task_cycles.sql",
      "0005_run_recovery.sql",
      "0006_agent_model_catalog.sql",
      "0007_global_notifications.sql",
      "0008_separate_agent_profiles.sql",
    ]) {
      copyFileSync(join(import.meta.dir, "../migrations", name), join(oldMigrations, name));
    }
    const path = join(directory, "aiws.sqlite");
    const legacy = openDatabase({ path, migrationsDirectory: oldMigrations });
    const timestamp = "2026-07-24T10:00:00.000Z";
    const connectionId = "con_00000000000000000000000001";
    const projectId = "prj_00000000000000000000000001";
    const taskId = "tsk_00000000000000000000000001";
    const deliveryId = "dlv_00000000000000000000000001";
    legacy
      .query(
        `INSERT INTO connections(
          id, provider, host, external_account_id, display_name, installation_id,
          status, created_at, updated_at
        ) VALUES (?, 'github', 'https://github.com', '42', 'acme', '42', 'active', ?, ?)`,
      )
      .run(connectionId, timestamp, timestamp);
    legacy
      .query(
        `INSERT INTO projects(
          id, name, description, repository_path, git_provider, account_scope,
          repository_mode, connection_id, remote_repository_id, remote_full_name,
          remote_web_url, default_branch, created_at, updated_at
        ) VALUES (?, 'Managed', '', '/repos/managed', 'github', 'personal',
          'managed', ?, '42', 'acme/managed', 'https://github.com/acme/managed',
          'release/legacy', ?, ?)`,
      )
      .run(projectId, connectionId, timestamp, timestamp);
    legacy
      .query(
        `INSERT INTO tasks(
          id, project_id, title, user_request, status, version, created_at, updated_at
        ) VALUES (?, ?, 'Legacy Task', 'Keep branch', 'draft', 1, ?, ?)`,
      )
      .run(taskId, projectId, timestamp, timestamp);
    legacy
      .query(
        `INSERT INTO deliveries(id, task_id, branch_name, pr_url, created_at, updated_at)
         VALUES (?, ?, 'aiws/legacy', NULL, ?, ?)`,
      )
      .run(deliveryId, taskId, timestamp, timestamp);
    legacy.close();

    const migrated = openDatabase({ path });
    expect(
      migrated.query<{ base_branch: string }, []>("SELECT base_branch FROM deliveries").get(),
    ).toEqual({ base_branch: "release/legacy" });
    expect(
      migrated
        .query<
          {
            provider: string;
            installation_id: string | null;
            organization_id: string | null;
          },
          [string]
        >(
          `SELECT provider, installation_id, organization_id
           FROM connections WHERE id = ?`,
        )
        .get(connectionId),
    ).toEqual({
      provider: "github",
      installation_id: "42",
      organization_id: null,
    });
    expect(
      migrated
        .query<{ connection_id: string | null }, [string]>(
          "SELECT connection_id FROM projects WHERE id = ?",
        )
        .get(projectId),
    ).toEqual({ connection_id: connectionId });
    migrated.close();
  });

  test("backfills the Ready policy and curation Run snapshot from an existing 0010 database", () => {
    const directory = temporaryDirectory();
    const oldMigrations = join(directory, "pre-ready-policy-migrations");
    mkdirSync(oldMigrations);
    for (const name of [
      "0001_initial.sql",
      "0002_managed_automation.sql",
      "0003_managed_curation.sql",
      "0004_task_cycles.sql",
      "0005_run_recovery.sql",
      "0006_agent_model_catalog.sql",
      "0007_global_notifications.sql",
      "0008_separate_agent_profiles.sql",
      "0009_delivery_base_branch.sql",
      "0010_azure_devops_provider.sql",
    ]) {
      copyFileSync(join(import.meta.dir, "../migrations", name), join(oldMigrations, name));
    }
    const path = join(directory, "aiws.sqlite");
    const legacy = openDatabase({ path, migrationsDirectory: oldMigrations });
    const timestamp = "2026-07-26T10:00:00.000Z";
    const profileId = "agp_00000000000000000000000001";
    const projectId = "prj_00000000000000000000000001";
    const taskId = "tsk_00000000000000000000000001";
    const runId = "run_00000000000000000000000001";
    legacy
      .query(
        `INSERT INTO agent_profiles(
          id, name, runtime, auth_mode, credential_reference, enabled, created_at, updated_at
        ) VALUES (?, 'Curator', 'codex', 'api_key', 'OPENAI_API_KEY', 1, ?, ?)`,
      )
      .run(profileId, timestamp, timestamp);
    legacy
      .query(
        `INSERT INTO projects(
          id, name, description, repository_path, git_provider, account_scope,
          repository_mode, automation_enabled, curation_agent_profile_id,
          schedule_timezone, max_concurrency, created_at, updated_at
        ) VALUES (?, 'Legacy', '', '/repos/legacy', 'github', 'personal',
          'local', 1, ?, 'UTC', 1, ?, ?)`,
      )
      .run(projectId, profileId, timestamp, timestamp);
    legacy
      .query(
        `INSERT INTO tasks(
          id, project_id, title, user_request, status, version, created_at, updated_at
        ) VALUES (?, ?, 'Legacy Task', 'Preserve behavior', 'curating', 1, ?, ?)`,
      )
      .run(taskId, projectId, timestamp, timestamp);
    legacy
      .query(
        `INSERT INTO runs(
          id, task_id, project_id, agent_profile_id, kind, outcome, attempt, status,
          task_version, execution_stage, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'curation', 'ready', 1, 'succeeded', 1, 'agent', ?, ?)`,
      )
      .run(runId, taskId, projectId, profileId, timestamp, timestamp);
    legacy.close();

    const migrated = openDatabase({ path });
    expect(
      migrated
        .query<{ ready_policy: string }, [string]>("SELECT ready_policy FROM projects WHERE id = ?")
        .get(projectId),
    ).toEqual({ ready_policy: "curator_decides" });
    expect(
      migrated
        .query<{ ready_approval_pending: number }, [string]>(
          "SELECT ready_approval_pending FROM tasks WHERE id = ?",
        )
        .get(taskId),
    ).toEqual({ ready_approval_pending: 0 });
    expect(
      migrated
        .query<
          {
            outcome: string;
            ready_policy: string;
            verification_contract_revision: number | null;
          },
          [string]
        >("SELECT outcome, ready_policy, verification_contract_revision FROM runs WHERE id = ?")
        .get(runId),
    ).toEqual({
      outcome: "ready",
      ready_policy: "curator_decides",
      verification_contract_revision: null,
    });
    migrated.close();
  });

  test("refuses to start when an applied migration checksum diverges", () => {
    const directory = temporaryDirectory();
    const migrations = join(directory, "migrations");
    const source = join(import.meta.dir, "../migrations/0001_initial.sql");
    const migration = join(migrations, "0001_initial.sql");
    mkdirSync(migrations);
    writeFileSync(migration, readFileSync(source));
    const path = join(directory, "aiws.sqlite");
    openDatabase({ path, migrationsDirectory: migrations }).close();
    appendFileSync(migration, "\n-- changed\n");

    expect(() => openDatabase({ path, migrationsDirectory: migrations })).toThrow(MigrationError);
  });

  test("refuses to apply a migration older than an already applied version", () => {
    const directory = temporaryDirectory();
    const path = join(directory, "aiws.sqlite");
    writeFileSync(join(directory, "0002_second.sql"), "CREATE TABLE second (id INTEGER) STRICT;");
    const database = new Database(path, { create: true, strict: true });
    runMigrations(database, { directory });
    writeFileSync(join(directory, "0001_first.sql"), "CREATE TABLE first (id INTEGER) STRICT;");

    expect(() => runMigrations(database, { directory })).toThrow(MigrationError);
    expect(
      database
        .query<{ count: number }, []>(
          "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'first'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .query<{ count: number }, []>("SELECT count(*) AS count FROM schema_migrations")
        .get(),
    ).toEqual({ count: 1 });
    database.close();
  });

  test("rolls back all statements from a failed migration", () => {
    const directory = temporaryDirectory();
    writeFileSync(
      join(directory, "0001_broken.sql"),
      "CREATE TABLE must_rollback (id INTEGER) STRICT; INVALID SQL;",
    );
    const database = new Database(":memory:", { strict: true });

    expect(() => runMigrations(database, { directory })).toThrow(MigrationError);
    expect(
      database
        .query<{ count: number }, [string]>(
          "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get("must_rollback"),
    ).toEqual({ count: 0 });
    expect(
      database
        .query<{ count: number }, []>("SELECT count(*) AS count FROM schema_migrations")
        .get(),
    ).toEqual({ count: 0 });
    database.close();
  });

  test("enforces foreign keys, principal CHECK constraints, and immutable user_request", () => {
    const database = openTemporaryDatabase();
    const now = "2026-07-21T10:00:00.000Z";
    database
      .query<void, [string, string, string, string, string, string, string, string]>(
        `INSERT INTO projects(
          id, name, description, repository_path, git_provider, account_scope, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "prj_00000000000000000000000001",
        "Project",
        "",
        "/repos/project",
        "github",
        "personal",
        now,
        now,
      );
    database
      .query<void, [string, string, string, string, string, string, number, string, string]>(
        `INSERT INTO tasks(
          id, project_id, title, user_request, curator_spec, status, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "tsk_00000000000000000000000001",
        "prj_00000000000000000000000001",
        "Task",
        "Original",
        "",
        "draft",
        1,
        now,
        now,
      );

    database.run("UPDATE tasks SET user_request = ? WHERE id = ?", [
      "Changed in Draft",
      "tsk_00000000000000000000000001",
    ]);
    database.run("UPDATE tasks SET status = 'curating' WHERE id = ?", [
      "tsk_00000000000000000000000001",
    ]);
    expect(() =>
      database.run("UPDATE tasks SET user_request = ? WHERE id = ?", [
        "Changed after Draft",
        "tsk_00000000000000000000000001",
      ]),
    ).toThrow("user_request is immutable after Draft");
    expect(() =>
      database.run(
        `INSERT INTO tasks(
          id, project_id, title, user_request, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "tsk_00000000000000000000000002",
          "prj_00000000000000000000000999",
          "Task",
          "Request",
          now,
          now,
        ],
      ),
    ).toThrow();
    expect(() =>
      database.run(
        `INSERT INTO projects(
          id, name, repository_path, git_provider, account_scope, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ["bad-id", "Project", "/repos/bad", "unknown", "personal", now, now],
      ),
    ).toThrow();
    expect(() =>
      database.run(
        `INSERT INTO questions(
          id, task_id, text, type, options_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          "qst_00000000000000000000000001",
          "tsk_00000000000000000000000001",
          "Question?",
          "single_choice",
          "[]",
          now,
          now,
        ],
      ),
    ).toThrow();
    expect(() =>
      database.run(
        `INSERT INTO attachments(
          id, task_id, original_name, storage_key, mime_type, size_bytes, sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "att_00000000000000000000000001",
          "tsk_00000000000000000000000001",
          "empty.txt",
          "attachments/task/file",
          "text/plain",
          0,
          "A".repeat(64),
          now,
        ],
      ),
    ).toThrow();
    database.close();
  });

  test("creates every index required by the SQL contract", () => {
    const database = openTemporaryDatabase();
    const names = database
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(names).toEqual([
      "idx_attachments_cycle_created",
      "idx_attachments_task_created",
      "idx_azure_oauth_authorizations_expires",
      "idx_connections_azure_organization",
      "idx_connections_github_installation",
      "idx_deliveries_checks_attention",
      "idx_deliveries_task_created",
      "idx_notification_outbox_due",
      "idx_projects_active_updated",
      "idx_projects_provider_scope",
      "idx_projects_remote_repository",
      "idx_question_answers_question_revision",
      "idx_questions_cycle_status",
      "idx_questions_task_status",
      "idx_runs_cycle_created",
      "idx_runs_project_active",
      "idx_runs_resume_from",
      "idx_runs_task_created",
      "idx_runs_task_kind_attempt",
      "idx_spec_revisions_task_created",
      "idx_task_cycles_task_number",
      "idx_task_events_task_created",
      "idx_task_messages_task_created",
      "idx_tasks_active_status_created",
      "idx_tasks_active_updated",
      "idx_tasks_archived_at",
      "idx_tasks_automation_ready",
      "idx_tasks_curation_candidates",
      "idx_tasks_project_active_status",
      "idx_verification_contract_project_revision",
    ]);
    database.close();
  });
});
