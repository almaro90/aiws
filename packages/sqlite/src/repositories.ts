import { createVerificationContractRevision } from "@aiws/core";
import type {
  Page,
  AttachmentId,
  AttachmentMetadataStore,
  Project,
  ProjectId,
  ProjectListQuery,
  ProjectStore,
  QuestionStore,
  Question,
  QuestionId,
  Task,
  TaskEvent,
  TaskEventListQuery,
  TaskEventStore,
  TaskId,
  TaskListQuery,
  TaskStore,
  TaskSummary,
  StoredAttachment,
  AgentProfile,
  AgentProfileId,
  AgentProfileStore,
  Connection,
  ConnectionId,
  ConnectionStore,
  Run,
  RunId,
  RunStore,
  CycleStore,
  MessageStore,
  SpecRevisionStore,
  QuestionAnswerStore,
  DeliveryStore,
  TimelineStore,
  TaskCycle,
  TaskCycleId,
  TaskMessage,
  TaskMessageId,
  SpecRevision,
  SpecRevisionId,
  QuestionAnswerSnapshot,
  QuestionAnswerId,
  QuestionOptionId,
  Delivery,
  DeliveryId,
  TimelineItem,
  VerificationContractStore,
  VerificationContractRevision,
  VerificationCommand,
  VerificationResult,
  VerificationResultStore,
  RunProvenance,
  RunProvenanceStore,
} from "@aiws/core";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { assertPageLimit, decodeCursor, encodeCursor, type CursorContext } from "./cursor.ts";
import {
  attachmentFromRow,
  type AttachmentRow,
  projectFromRow,
  type ProjectRow,
  questionFromRow,
  type QuestionRow,
  taskEventFromRow,
  type TaskEventRow,
  taskFromRow,
  type TaskRow,
  taskSummaryFromRow,
  type TaskSummaryRow,
  agentProfileFromRow,
  type AgentProfileRow,
  connectionFromRow,
  type ConnectionRow,
  runFromRow,
  type RunRow,
} from "./mappers.ts";

type Bindings = SQLQueryBindings[];

interface TaskCycleRow {
  readonly id: string;
  readonly task_id: string;
  readonly number: number;
  readonly delivery_id: string | null;
  readonly created_at: string;
  readonly completed_at: string | null;
}

interface TaskMessageRow {
  readonly id: string;
  readonly task_id: string;
  readonly cycle_id: string;
  readonly type: TaskMessage["type"];
  readonly text: string | null;
  readonly created_at: string;
}

interface SpecRevisionRow {
  readonly id: string;
  readonly task_id: string;
  readonly cycle_id: string;
  readonly revision: number;
  readonly content: string;
  readonly created_at: string;
}

interface QuestionAnswerRow {
  readonly id: string;
  readonly question_id: string;
  readonly cycle_id: string;
  readonly revision: number;
  readonly answer_text: string | null;
  readonly selected_option_ids_json: string;
  readonly created_at: string;
}

interface DeliveryRow {
  readonly id: string;
  readonly task_id: string;
  readonly branch_name: string | null;
  readonly base_branch: string | null;
  readonly pr_url: string | null;
  readonly pr_state: string | null;
  readonly checks_state: string | null;
  readonly checks_passed: number;
  readonly checks_failed: number;
  readonly checks_pending: number;
  readonly external_updated_at: string | null;
  readonly last_synchronized_at: string | null;
  readonly synchronization_error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface VerificationContractRevisionRow {
  readonly project_id: string;
  readonly revision: number;
  readonly enabled: number;
  readonly commands_json: string;
  readonly created_at: string;
}

export class SqliteProjectRepository implements ProjectStore {
  constructor(private readonly database: Database) {}

  async getById(id: ProjectId): Promise<Project | null> {
    const row = this.database
      .query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = ?")
      .get(id);
    return row === null ? null : projectFromRow(row);
  }

  async list(query: ProjectListQuery): Promise<Page<Project>> {
    assertPageLimit(query.limit);
    const context: CursorContext = {
      sort: "updated_at",
      order: "desc",
      filter: {
        archived: query.archived,
        gitProvider: query.gitProvider,
        accountScope: query.accountScope,
      },
    };
    const conditions = [query.archived ? "archived_at IS NOT NULL" : "archived_at IS NULL"];
    const bindings: Bindings = [];
    if (query.gitProvider !== undefined) {
      conditions.push("git_provider = ?");
      bindings.push(query.gitProvider);
    }
    if (query.accountScope !== undefined) {
      conditions.push("account_scope = ?");
      bindings.push(query.accountScope);
    }
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor, context);
      conditions.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
      bindings.push(cursor.value, cursor.value, cursor.id);
    }
    bindings.push(query.limit + 1);
    const rows = this.database
      .query<ProjectRow, Bindings>(
        `SELECT * FROM projects
         WHERE ${conditions.join(" AND ")}
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`,
      )
      .all(...bindings);
    const pageRows = rows.slice(0, query.limit);
    const items = pageRows.map(projectFromRow);
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeCursor(context, { value: last.updated_at, id: last.id })
          : null,
    };
  }

  async repositoryPathExists(repositoryPath: string, excludingId?: ProjectId): Promise<boolean> {
    const row =
      excludingId === undefined
        ? this.database
            .query<{ readonly found: number }, [string]>(
              "SELECT 1 AS found FROM projects WHERE repository_path = ? LIMIT 1",
            )
            .get(repositoryPath)
        : this.database
            .query<{ readonly found: number }, [string, string]>(
              "SELECT 1 AS found FROM projects WHERE repository_path = ? AND id <> ? LIMIT 1",
            )
            .get(repositoryPath, excludingId);
    return row !== null;
  }

  async insert(project: Project): Promise<void> {
    this.database
      .query<
        void,
        [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          number,
          string | null,
          string | null,
          string | null,
          string,
          number,
          string,
          string,
          string,
          string | null,
        ]
      >(
        `INSERT INTO projects(
           id, name, description, repository_path, git_provider, account_scope,
           repository_mode, connection_id, remote_repository_id, remote_full_name,
           remote_web_url, default_branch, automation_enabled, curation_agent_profile_id,
           implementation_agent_profile_id,
           schedule_cron, schedule_timezone, max_concurrency, ready_policy,
           created_at, updated_at, archived_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.description,
        project.repositoryPath,
        project.gitProvider,
        project.accountScope,
        project.repositoryMode,
        project.connectionId,
        project.remoteRepositoryId,
        project.remoteFullName,
        project.remoteWebUrl,
        project.defaultBranch,
        project.automationEnabled ? 1 : 0,
        project.curationAgentProfileId,
        project.implementationAgentProfileId,
        project.scheduleCron,
        project.scheduleTimezone,
        project.maxConcurrency,
        project.readyPolicy,
        project.createdAt,
        project.updatedAt,
        project.archivedAt,
      );
  }

  async update(project: Project): Promise<void> {
    this.database
      .query<
        void,
        [
          string,
          string,
          string,
          string,
          string,
          string | null,
          number,
          string | null,
          string | null,
          string | null,
          string,
          number,
          string,
          string,
          string | null,
          string,
        ]
      >(
        `UPDATE projects SET
           name = ?, description = ?, repository_path = ?, git_provider = ?,
           account_scope = ?, default_branch = ?, automation_enabled = ?, curation_agent_profile_id = ?,
           implementation_agent_profile_id = ?,
           schedule_cron = ?, schedule_timezone = ?, max_concurrency = ?, ready_policy = ?,
           updated_at = ?, archived_at = ?
         WHERE id = ?`,
      )
      .run(
        project.name,
        project.description,
        project.repositoryPath,
        project.gitProvider,
        project.accountScope,
        project.defaultBranch,
        project.automationEnabled ? 1 : 0,
        project.curationAgentProfileId,
        project.implementationAgentProfileId,
        project.scheduleCron,
        project.scheduleTimezone,
        project.maxConcurrency,
        project.readyPolicy,
        project.updatedAt,
        project.archivedAt,
        project.id,
      );
  }

  async countActiveTasks(projectId: ProjectId): Promise<number> {
    const row = this.database
      .query<{ readonly count: number }, [string]>(
        "SELECT count(*) AS count FROM tasks WHERE project_id = ? AND archived_at IS NULL",
      )
      .get(projectId);
    return row?.count ?? 0;
  }
}

export class SqliteVerificationContractRepository implements VerificationContractStore {
  constructor(private readonly database: Database) {}

  async getLatest(projectId: ProjectId): Promise<VerificationContractRevision | null> {
    const row = this.database
      .query<VerificationContractRevisionRow, [string]>(
        `SELECT * FROM verification_contract_revisions
         WHERE project_id = ? ORDER BY revision DESC LIMIT 1`,
      )
      .get(projectId);
    return row === null ? null : verificationContractFromRow(row);
  }

  async getRevision(
    projectId: ProjectId,
    revision: number,
  ): Promise<VerificationContractRevision | null> {
    const row = this.database
      .query<VerificationContractRevisionRow, [string, number]>(
        "SELECT * FROM verification_contract_revisions WHERE project_id = ? AND revision = ?",
      )
      .get(projectId, revision);
    return row === null ? null : verificationContractFromRow(row);
  }

  async list(projectId: ProjectId): Promise<readonly VerificationContractRevision[]> {
    return this.database
      .query<VerificationContractRevisionRow, [string]>(
        `SELECT * FROM verification_contract_revisions
         WHERE project_id = ? ORDER BY revision DESC`,
      )
      .all(projectId)
      .map(verificationContractFromRow);
  }

  async insert(value: VerificationContractRevision): Promise<void> {
    this.database
      .query<void, [string, number, number, string, string]>(
        `INSERT INTO verification_contract_revisions(
           project_id, revision, enabled, commands_json, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        value.projectId,
        value.revision,
        value.enabled ? 1 : 0,
        JSON.stringify(value.commands),
        value.createdAt,
      );
  }
}

export class SqliteTaskRepository implements TaskStore {
  constructor(private readonly database: Database) {}

  async getById(id: TaskId): Promise<Task | null> {
    const row = this.database.query<TaskRow, [string]>("SELECT * FROM tasks WHERE id = ?").get(id);
    return row === null ? null : taskFromRow(row);
  }

  async list(query: TaskListQuery): Promise<Page<TaskSummary>> {
    assertPageLimit(query.limit);
    const statuses = [...new Set(query.statuses ?? [])].sort();
    const sortColumn = query.sort === "updatedAt" ? "t.updated_at" : "t.created_at";
    const cursorSort = query.sort === "updatedAt" ? "updated_at" : "created_at";
    const context: CursorContext = {
      sort: cursorSort,
      order: query.order,
      filter: {
        archived: query.archived,
        projectId: query.projectId,
        statuses,
        accountScope: query.accountScope,
        gitProvider: query.gitProvider,
      },
    };
    const conditions = [query.archived ? "t.archived_at IS NOT NULL" : "t.archived_at IS NULL"];
    const bindings: Bindings = [];
    if (query.projectId !== undefined) {
      conditions.push("t.project_id = ?");
      bindings.push(query.projectId);
    }
    if (statuses.length > 0) {
      conditions.push(`t.status IN (${statuses.map(() => "?").join(", ")})`);
      bindings.push(...statuses);
    }
    if (query.accountScope !== undefined) {
      conditions.push("p.account_scope = ?");
      bindings.push(query.accountScope);
    }
    if (query.gitProvider !== undefined) {
      conditions.push("p.git_provider = ?");
      bindings.push(query.gitProvider);
    }
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor, context);
      const operator = query.order === "asc" ? ">" : "<";
      conditions.push(
        `(${sortColumn} ${operator} ? OR (${sortColumn} = ? AND t.id ${operator} ?))`,
      );
      bindings.push(cursor.value, cursor.value, cursor.id);
    }
    const direction = query.order === "asc" ? "ASC" : "DESC";
    bindings.push(query.limit + 1);
    const rows = this.database
      .query<TaskSummaryRow, Bindings>(
        `SELECT
           t.id, t.project_id, p.name AS project_name, t.title, t.status, t.version,
           t.pr_url, t.created_at, t.updated_at, t.archived_at
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY ${sortColumn} ${direction}, t.id ${direction}
         LIMIT ?`,
      )
      .all(...bindings);
    const pageRows = rows.slice(0, query.limit);
    const items = pageRows.map(taskSummaryFromRow);
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeCursor(context, {
              value: query.sort === "updatedAt" ? last.updated_at : last.created_at,
              id: last.id,
            })
          : null,
    };
  }

  async insert(task: Task): Promise<void> {
    this.database
      .query<
        void,
        [
          string,
          string,
          string,
          string,
          string,
          string,
          string | null,
          number,
          string,
          string,
          string | null,
          number,
          string,
          string | null,
          number,
        ]
      >(
        `INSERT INTO tasks(
           id, project_id, title, user_request, curator_spec, status, pr_url, version,
           created_at, updated_at, archived_at, automation_paused, current_cycle_id,
           current_delivery_id, ready_approval_pending
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.projectId,
        task.title,
        task.userRequest,
        task.curatorSpec,
        task.status,
        task.prUrl,
        task.version,
        task.createdAt,
        task.updatedAt,
        task.archivedAt,
        task.automationPaused ? 1 : 0,
        task.currentCycleId,
        task.currentDeliveryId,
        task.readyApprovalPending ? 1 : 0,
      );
    this.database
      .query<void, [string, string, string]>(
        "INSERT OR IGNORE INTO task_cycles(id,task_id,number,created_at) VALUES (?, ?, 1, ?)",
      )
      .run(task.currentCycleId, task.id, task.createdAt);
  }

  async updateIfVersion(task: Task, expectedVersion: number): Promise<boolean> {
    if (task.version !== expectedVersion + 1) {
      throw new Error("Task mutation must increment version exactly once.");
    }
    const result = this.database
      .query<
        void,
        [
          string,
          string,
          string,
          string,
          string | null,
          number,
          string,
          string | null,
          number,
          string,
          string | null,
          number,
          string,
          number,
          string | null,
        ]
      >(
        `UPDATE tasks SET
           title = ?, user_request = ?, curator_spec = ?, status = ?, pr_url = ?, version = ?,
           updated_at = ?, archived_at = ?, automation_paused = ?, current_cycle_id = ?,
           current_delivery_id = ?, ready_approval_pending = ?
         WHERE id = ? AND version = ?
           AND (archived_at IS NULL OR (? IS NULL AND archived_at IS NOT NULL))`,
      )
      .run(
        task.title,
        task.userRequest,
        task.curatorSpec,
        task.status,
        task.prUrl,
        task.version,
        task.updatedAt,
        task.archivedAt,
        task.automationPaused ? 1 : 0,
        task.currentCycleId,
        task.currentDeliveryId,
        task.readyApprovalPending ? 1 : 0,
        task.id,
        expectedVersion,
        task.archivedAt,
      );
    return result.changes === 1;
  }

  async listAutomationCandidates(limit: number): Promise<readonly Task[]> {
    return this.database
      .query<TaskRow, [number]>(
        `SELECT t.* FROM tasks t
         JOIN projects p ON p.id = t.project_id
         WHERE t.status = 'ready' AND t.archived_at IS NULL AND t.automation_paused = 0
           AND p.archived_at IS NULL AND p.automation_enabled = 1
         ORDER BY t.created_at ASC, t.id ASC LIMIT ?`,
      )
      .all(limit)
      .map(taskFromRow);
  }

  async listCurationCandidates(limit: number): Promise<readonly Task[]> {
    return this.database
      .query<TaskRow, [number]>(
        `SELECT t.* FROM tasks t
         JOIN projects p ON p.id = t.project_id
         WHERE t.status = 'curating' AND t.archived_at IS NULL AND t.automation_paused = 0
           AND t.ready_approval_pending = 0
           AND p.archived_at IS NULL AND p.repository_mode = 'managed'
           AND p.curation_agent_profile_id IS NOT NULL
         ORDER BY t.created_at ASC, t.id ASC LIMIT ?`,
      )
      .all(limit)
      .map(taskFromRow);
  }
}

export class SqliteQuestionRepository implements QuestionStore {
  constructor(private readonly database: Database) {}

  async getById(id: QuestionId): Promise<Question | null> {
    const row = this.database
      .query<QuestionRow, [string]>("SELECT * FROM questions WHERE id = ?")
      .get(id);
    return row === null ? null : questionFromRow(row);
  }

  async countOpenByTaskId(taskId: TaskId, cycleId?: TaskCycleId): Promise<number> {
    const row =
      cycleId === undefined
        ? this.database
            .query<{ readonly count: number }, [string]>(
              "SELECT count(*) AS count FROM questions WHERE task_id = ? AND status = 'open'",
            )
            .get(taskId)
        : this.database
            .query<{ readonly count: number }, [string, string]>(
              "SELECT count(*) AS count FROM questions WHERE task_id = ? AND cycle_id = ? AND status = 'open'",
            )
            .get(taskId, cycleId);
    return row?.count ?? 0;
  }

  async listByTaskId(taskId: TaskId): Promise<readonly Question[]> {
    return this.database
      .query<QuestionRow, [string]>(
        "SELECT * FROM questions WHERE task_id = ? ORDER BY created_at ASC, id ASC",
      )
      .all(taskId)
      .map(questionFromRow);
  }

  async insert(question: Question): Promise<void> {
    this.database
      .query<
        void,
        [
          string,
          string,
          string,
          string,
          string,
          string,
          number,
          string | null,
          string,
          string,
          string,
          string,
          string | null,
          string | null,
        ]
      >(
        `INSERT INTO questions(
           id, task_id, cycle_id, text, type, options_json, allow_other, answer_text,
           selected_option_ids_json, status, created_at, updated_at, answered_at, dismissed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        question.id,
        question.taskId,
        question.cycleId,
        question.text,
        question.type,
        JSON.stringify(question.options),
        question.allowOther ? 1 : 0,
        question.answerText,
        JSON.stringify(question.selectedOptionIds),
        question.status,
        question.createdAt,
        question.updatedAt,
        question.answeredAt,
        question.dismissedAt,
      );
  }

  async update(question: Question): Promise<void> {
    const result = this.database
      .query<
        void,
        [
          string,
          string,
          string,
          number,
          string | null,
          string,
          string,
          string,
          string | null,
          string | null,
          string,
          string,
        ]
      >(
        `UPDATE questions SET
           text = ?, type = ?, options_json = ?, allow_other = ?, answer_text = ?,
           selected_option_ids_json = ?, status = ?, updated_at = ?, answered_at = ?, dismissed_at = ?
         WHERE id = ? AND task_id = ?`,
      )
      .run(
        question.text,
        question.type,
        JSON.stringify(question.options),
        question.allowOther ? 1 : 0,
        question.answerText,
        JSON.stringify(question.selectedOptionIds),
        question.status,
        question.updatedAt,
        question.answeredAt,
        question.dismissedAt,
        question.id,
        question.taskId,
      );
    if (result.changes !== 1) throw new Error("Question update did not affect exactly one row.");
  }
}

export class SqliteAttachmentMetadataRepository implements AttachmentMetadataStore {
  constructor(private readonly database: Database) {}

  async getById(id: AttachmentId): Promise<StoredAttachment | null> {
    const row = this.database
      .query<AttachmentRow, [string]>("SELECT * FROM attachments WHERE id = ?")
      .get(id);
    return row === null ? null : attachmentFromRow(row);
  }

  async countByTaskId(taskId: TaskId): Promise<number> {
    const row = this.database
      .query<{ readonly count: number }, [string]>(
        "SELECT count(*) AS count FROM attachments WHERE task_id = ?",
      )
      .get(taskId);
    return row?.count ?? 0;
  }

  async listByTaskId(taskId: TaskId): Promise<readonly StoredAttachment[]> {
    return this.database
      .query<AttachmentRow, [string]>(
        "SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at ASC, id ASC",
      )
      .all(taskId)
      .map(attachmentFromRow);
  }

  async insert(attachment: StoredAttachment): Promise<void> {
    this.database
      .query<
        void,
        [string, string, string, string | null, string, string, string, number, string, string]
      >(
        `INSERT INTO attachments(
           id, task_id, cycle_id, message_id, original_name, storage_key, mime_type, size_bytes, sha256, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attachment.id,
        attachment.taskId,
        attachment.cycleId,
        attachment.messageId,
        attachment.originalName,
        attachment.storageKey,
        attachment.mimeType,
        attachment.sizeBytes,
        attachment.sha256,
        attachment.createdAt,
      );
  }

  async remove(id: AttachmentId, taskId: TaskId): Promise<boolean> {
    return (
      this.database
        .query<void, [string, string]>("DELETE FROM attachments WHERE id = ? AND task_id = ?")
        .run(id, taskId).changes === 1
    );
  }
}

export class SqliteTaskEventRepository implements TaskEventStore {
  constructor(private readonly database: Database) {}

  async append(events: readonly TaskEvent[]): Promise<void> {
    const statement = this.database.query<
      void,
      [string, string, string, string, string, string, string]
    >(
      `INSERT INTO task_events(id, task_id, type, actor_type, metadata_json, created_at, cycle_id)
       VALUES (?, ?, ?, ?, ?, ?, (SELECT current_cycle_id FROM tasks WHERE id = ?))`,
    );
    for (const event of events) {
      statement.run(
        event.id,
        event.taskId,
        event.type,
        event.actorType,
        JSON.stringify(event.metadata),
        event.createdAt,
        event.taskId,
      );
      if (event.type === "status_changed") {
        this.enqueueStatusNotification(event);
      }
    }
  }

  private enqueueStatusNotification(event: TaskEvent): void {
    const from = event.metadata.from;
    const to = event.metadata.to;
    if (typeof from !== "string" || typeof to !== "string") {
      throw new Error("status_changed event metadata is invalid.");
    }
    this.database
      .query<void, [string, string, string, string, string, string]>(
        `INSERT INTO notification_outbox(
           event_id, generation, project_id, project_name, task_id, task_title,
           from_status, to_status, attempt_count, next_attempt_at, last_error, created_at
         )
         SELECT ?, settings.generation, projects.id, projects.name, tasks.id, tasks.title,
                ?, ?, 0, ?, NULL, ?
         FROM notification_settings AS settings
         JOIN tasks ON tasks.id = ?
         JOIN projects ON projects.id = tasks.project_id
         WHERE settings.singleton_id = 1 AND settings.enabled = 1`,
      )
      .run(event.id, from, to, event.createdAt, event.createdAt, event.taskId);
  }

  async list(query: TaskEventListQuery): Promise<Page<TaskEvent>> {
    assertPageLimit(query.limit);
    const context: CursorContext = {
      sort: "created_at",
      order: "desc",
      filter: { taskId: query.taskId },
    };
    const conditions = ["task_id = ?"];
    const bindings: Bindings = [query.taskId];
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor, context);
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      bindings.push(cursor.value, cursor.value, cursor.id);
    }
    bindings.push(query.limit + 1);
    const rows = this.database
      .query<TaskEventRow, Bindings>(
        `SELECT * FROM task_events
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(...bindings);
    const pageRows = rows.slice(0, query.limit);
    const items = pageRows.map(taskEventFromRow);
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeCursor(context, { value: last.created_at, id: last.id })
          : null,
    };
  }
}

export class SqliteConnectionRepository implements ConnectionStore {
  constructor(private readonly database: Database) {}

  async getById(id: ConnectionId): Promise<Connection | null> {
    const row = this.database
      .query<ConnectionRow, [string]>("SELECT * FROM connections WHERE id = ?")
      .get(id);
    return row === null ? null : connectionFromRow(row);
  }
  async list(): Promise<readonly Connection[]> {
    return this.database
      .query<ConnectionRow, []>("SELECT * FROM connections ORDER BY created_at ASC, id ASC")
      .all()
      .map(connectionFromRow);
  }
  async findByInstallation(
    provider: "github",
    host: string,
    installationId: string,
  ): Promise<Connection | null> {
    const row = this.database
      .query<ConnectionRow, [string, string, string]>(
        "SELECT * FROM connections WHERE provider = ? AND host = ? AND installation_id = ?",
      )
      .get(provider, host, installationId);
    return row === null ? null : connectionFromRow(row);
  }
  async findByOrganization(
    provider: "azure_devops",
    host: string,
    organizationId: string,
  ): Promise<Connection | null> {
    const row = this.database
      .query<ConnectionRow, [string, string, string]>(
        "SELECT * FROM connections WHERE provider = ? AND host = ? AND organization_id = ?",
      )
      .get(provider, host, organizationId);
    return row === null ? null : connectionFromRow(row);
  }
  async insert(connection: Connection): Promise<void> {
    this.database
      .query<
        void,
        [
          string,
          string,
          string,
          string,
          string,
          string | null,
          string | null,
          string | null,
          string,
          string,
          string,
        ]
      >(
        `INSERT INTO connections(
           id, provider, host, external_account_id, display_name, installation_id,
           organization_id, organization_name, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        connection.id,
        connection.provider,
        connection.host,
        connection.externalAccountId,
        connection.displayName,
        connection.provider === "github" ? connection.installationId : null,
        connection.provider === "azure_devops" ? connection.organizationId : null,
        connection.provider === "azure_devops" ? connection.organizationName : null,
        connection.status,
        connection.createdAt,
        connection.updatedAt,
      );
  }
  async update(connection: Connection): Promise<void> {
    this.database
      .query<void, [string, string, string | null, string, string, string]>(
        `UPDATE connections
         SET external_account_id = ?, display_name = ?, organization_name = ?,
             status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        connection.externalAccountId,
        connection.displayName,
        connection.provider === "azure_devops" ? connection.organizationName : null,
        connection.status,
        connection.updatedAt,
        connection.id,
      );
  }
}

export class SqliteAgentProfileRepository implements AgentProfileStore {
  constructor(private readonly database: Database) {}
  async getById(id: AgentProfileId): Promise<AgentProfile | null> {
    const row = this.database
      .query<AgentProfileRow, [string]>("SELECT * FROM agent_profiles WHERE id = ?")
      .get(id);
    return row === null ? null : agentProfileFromRow(row);
  }
  async list(): Promise<readonly AgentProfile[]> {
    return this.database
      .query<AgentProfileRow, []>("SELECT * FROM agent_profiles ORDER BY created_at ASC, id ASC")
      .all()
      .map(agentProfileFromRow);
  }
  async nameExists(name: string): Promise<boolean> {
    return (
      this.database
        .query<{ readonly found: number }, [string]>(
          "SELECT 1 AS found FROM agent_profiles WHERE name = ? LIMIT 1",
        )
        .get(name) !== null
    );
  }
  async insert(profile: AgentProfile): Promise<void> {
    this.database
      .query<
        void,
        [
          string,
          string,
          string,
          string,
          string,
          string | null,
          string | null,
          number,
          string,
          string,
        ]
      >(
        `INSERT INTO agent_profiles(id, name, runtime, auth_mode, credential_reference, model, reasoning_effort, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profile.id,
        profile.name,
        profile.runtime,
        profile.authMode,
        profile.credentialReference,
        profile.model,
        profile.reasoningEffort,
        profile.enabled ? 1 : 0,
        profile.createdAt,
        profile.updatedAt,
      );
  }
  async update(profile: AgentProfile): Promise<void> {
    this.database
      .query<void, [number, string, string]>(
        "UPDATE agent_profiles SET enabled = ?, updated_at = ? WHERE id = ?",
      )
      .run(profile.enabled ? 1 : 0, profile.updatedAt, profile.id);
  }
}

export class SqliteRunRepository implements RunStore {
  constructor(private readonly database: Database) {}
  async getById(id: RunId): Promise<Run | null> {
    const row = this.database.query<RunRow, [string]>("SELECT * FROM runs WHERE id = ?").get(id);
    return row === null ? null : runFromRow(row);
  }
  async getNextQueued(): Promise<Run | null> {
    const row = this.database
      .query<RunRow, []>(
        "SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at ASC, id ASC LIMIT 1",
      )
      .get();
    return row === null ? null : runFromRow(row);
  }
  async listByTaskId(taskId: TaskId, kind?: Run["kind"]): Promise<readonly Run[]> {
    const rows =
      kind === undefined
        ? this.database
            .query<RunRow, [string]>(
              "SELECT * FROM runs WHERE task_id = ? ORDER BY created_at DESC, id DESC",
            )
            .all(taskId)
        : this.database
            .query<RunRow, [string, string]>(
              "SELECT * FROM runs WHERE task_id = ? AND kind = ? ORDER BY created_at DESC, id DESC",
            )
            .all(taskId, kind);
    return rows.map(runFromRow);
  }
  async listStaleActive(before: string): Promise<readonly Run[]> {
    return this.database
      .query<RunRow, [string]>(
        `SELECT * FROM runs
         WHERE status IN ('queued', 'preparing', 'running', 'verifying', 'publishing')
           AND coalesce(heartbeat_at, created_at) < ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(before)
      .map(runFromRow);
  }
  async countActiveByProject(projectId: ProjectId): Promise<number> {
    return (
      this.database
        .query<{ readonly count: number }, [string]>(
          "SELECT count(*) AS count FROM runs WHERE project_id = ? AND status IN ('queued', 'preparing', 'running', 'verifying', 'publishing')",
        )
        .get(projectId)?.count ?? 0
    );
  }
  async nextAttempt(taskId: TaskId, kind: Run["kind"]): Promise<number> {
    return (
      this.database
        .query<{ readonly attempt: number }, [string, string]>(
          "SELECT coalesce(max(attempt), 0) + 1 AS attempt FROM runs WHERE task_id = ? AND kind = ?",
        )
        .get(taskId, kind)?.attempt ?? 1
    );
  }
  async insert(run: Run): Promise<void> {
    this.database
      .query<
        void,
        [
          string,
          string,
          string,
          string | null,
          string,
          string,
          string,
          string | null,
          number,
          string,
          number,
          string,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          number | null,
          string | null,
          string | null,
          string,
          string,
        ]
      >(
        `INSERT INTO runs(id, task_id, cycle_id, delivery_id, project_id, agent_profile_id, kind, outcome, attempt, status, task_version, execution_stage, resume_from_run_id, branch_name, base_sha, head_sha, pr_url, summary, error_code, error_message, logs_storage_key, heartbeat_at, started_at, finished_at, ready_policy, verification_contract_revision, verification_waiver_run_id, verification_waiver_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.taskId,
        run.cycleId,
        run.deliveryId,
        run.projectId,
        run.agentProfileId,
        run.kind,
        run.outcome,
        run.attempt,
        run.status,
        run.taskVersion,
        run.executionStage,
        run.resumeFromRunId,
        run.branchName,
        run.baseSha,
        run.headSha,
        run.prUrl,
        run.summary,
        run.errorCode,
        run.errorMessage,
        run.logsStorageKey,
        run.heartbeatAt,
        run.startedAt,
        run.finishedAt,
        run.readyPolicy,
        run.verificationContractRevision,
        run.verificationWaiverRunId,
        run.verificationWaiverReason,
        run.createdAt,
        run.updatedAt,
      );
  }
  async update(run: Run): Promise<void> {
    this.database
      .query<
        void,
        [
          string,
          string | null,
          string,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string,
          string,
        ]
      >(
        `UPDATE runs SET status = ?, outcome = ?, execution_stage = ?, resume_from_run_id = ?, base_sha = ?, head_sha = ?, pr_url = ?, summary = ?, error_code = ?, error_message = ?, logs_storage_key = ?, heartbeat_at = ?, started_at = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        run.status,
        run.outcome,
        run.executionStage,
        run.resumeFromRunId,
        run.baseSha,
        run.headSha,
        run.prUrl,
        run.summary,
        run.errorCode,
        run.errorMessage,
        run.logsStorageKey,
        run.heartbeatAt,
        run.startedAt,
        run.finishedAt,
        run.updatedAt,
        run.id,
      );
  }
}

interface VerificationResultRow {
  readonly run_id: string;
  readonly position: number;
  readonly name: string;
  readonly executable: string;
  readonly args_json: string;
  readonly required: number;
  readonly status: string;
  readonly started_at: string;
  readonly finished_at: string;
  readonly duration_ms: number;
  readonly exit_code: number | null;
  readonly stdout_excerpt: string;
  readonly stderr_excerpt: string;
  readonly image_digest: string;
  readonly toolchain_identity: string;
}

export class SqliteVerificationResultRepository implements VerificationResultStore {
  constructor(private readonly database: Database) {}

  async listByRunId(runId: RunId): Promise<readonly VerificationResult[]> {
    return this.database
      .query<VerificationResultRow, [string]>(
        "SELECT * FROM verification_results WHERE run_id = ? ORDER BY position ASC",
      )
      .all(runId)
      .map((row) => ({
        runId: row.run_id as RunId,
        position: row.position,
        name: row.name,
        executable: row.executable,
        args: JSON.parse(row.args_json) as string[],
        required: row.required === 1,
        status: row.status as VerificationResult["status"],
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        durationMs: row.duration_ms,
        exitCode: row.exit_code,
        stdoutExcerpt: row.stdout_excerpt,
        stderrExcerpt: row.stderr_excerpt,
        imageDigest: row.image_digest,
        toolchainIdentity: row.toolchain_identity,
      }));
  }

  async insertMany(results: readonly VerificationResult[]): Promise<void> {
    const statement = this.database.query<
      void,
      [
        string,
        number,
        string,
        string,
        string,
        number,
        string,
        string,
        string,
        number,
        number | null,
        string,
        string,
        string,
        string,
      ]
    >(
      `INSERT INTO verification_results(
         run_id, position, name, executable, args_json, required, status, started_at,
         finished_at, duration_ms, exit_code, stdout_excerpt, stderr_excerpt,
         image_digest, toolchain_identity
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const result of results)
      statement.run(
        result.runId,
        result.position,
        result.name,
        result.executable,
        JSON.stringify(result.args),
        result.required ? 1 : 0,
        result.status,
        result.startedAt,
        result.finishedAt,
        result.durationMs,
        result.exitCode,
        result.stdoutExcerpt,
        result.stderrExcerpt,
        result.imageDigest,
        result.toolchainIdentity,
      );
  }
}

interface RunProvenanceRow {
  readonly run_id: string;
  readonly payload_json: string;
}

export class SqliteRunProvenanceRepository implements RunProvenanceStore {
  constructor(private readonly database: Database) {}
  async getByRunId(runId: RunId): Promise<RunProvenance | null> {
    const row = this.database
      .query<RunProvenanceRow, [string]>(
        "SELECT run_id, payload_json FROM run_provenance WHERE run_id = ?",
      )
      .get(runId);
    return row === null ? null : (JSON.parse(row.payload_json) as RunProvenance);
  }
  async insert(provenance: RunProvenance): Promise<void> {
    this.database
      .query<void, [string, number, string, string]>(
        "INSERT INTO run_provenance(run_id, schema_version, payload_json, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        provenance.runId,
        provenance.schemaVersion,
        JSON.stringify(provenance),
        provenance.createdAt,
      );
  }
}

export class SqliteCycleRepository implements CycleStore {
  constructor(private readonly database: Database) {}
  async getById(id: TaskCycleId): Promise<TaskCycle | null> {
    const row = this.database
      .query<TaskCycleRow, [string]>("SELECT * FROM task_cycles WHERE id = ?")
      .get(id);
    return row === null ? null : cycleFromRow(row);
  }
  async listByTaskId(taskId: TaskId): Promise<readonly TaskCycle[]> {
    return this.database
      .query<TaskCycleRow, [string]>(
        "SELECT * FROM task_cycles WHERE task_id = ? ORDER BY number ASC",
      )
      .all(taskId)
      .map(cycleFromRow);
  }
  async nextNumber(taskId: TaskId): Promise<number> {
    return (
      this.database
        .query<{ number: number }, [string]>(
          "SELECT coalesce(max(number), 0) + 1 AS number FROM task_cycles WHERE task_id = ?",
        )
        .get(taskId)?.number ?? 1
    );
  }
  async insert(cycle: TaskCycle): Promise<void> {
    this.database
      .query<void, [string, string, number, string | null, string, string | null]>(
        "INSERT OR IGNORE INTO task_cycles(id, task_id, number, delivery_id, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        cycle.id,
        cycle.taskId,
        cycle.number,
        cycle.deliveryId,
        cycle.createdAt,
        cycle.completedAt,
      );
  }
  async update(cycle: TaskCycle): Promise<void> {
    this.database
      .query<void, [string | null, string | null, string]>(
        "UPDATE task_cycles SET delivery_id = ?, completed_at = ? WHERE id = ?",
      )
      .run(cycle.deliveryId, cycle.completedAt, cycle.id);
  }
}

export class SqliteMessageRepository implements MessageStore {
  constructor(private readonly database: Database) {}
  async getById(id: TaskMessageId): Promise<TaskMessage | null> {
    const row = this.database
      .query<TaskMessageRow, [string]>("SELECT * FROM task_messages WHERE id = ?")
      .get(id);
    return row === null ? null : messageFromRow(row);
  }
  async listByTaskId(taskId: TaskId): Promise<readonly TaskMessage[]> {
    return this.database
      .query<TaskMessageRow, [string]>(
        "SELECT * FROM task_messages WHERE task_id = ? ORDER BY created_at ASC, id ASC",
      )
      .all(taskId)
      .map(messageFromRow);
  }
  async insert(message: TaskMessage): Promise<void> {
    this.database
      .query<void, [string, string, string, string, string | null, string]>(
        "INSERT INTO task_messages(id, task_id, cycle_id, type, text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        message.id,
        message.taskId,
        message.cycleId,
        message.type,
        message.text,
        message.createdAt,
      );
  }
}

export class SqliteSpecRevisionRepository implements SpecRevisionStore {
  constructor(private readonly database: Database) {}
  async listByTaskId(taskId: TaskId): Promise<readonly SpecRevision[]> {
    return this.database
      .query<SpecRevisionRow, [string]>(
        "SELECT * FROM spec_revisions WHERE task_id = ? ORDER BY created_at ASC, id ASC",
      )
      .all(taskId)
      .map(specFromRow);
  }
  async nextRevision(taskId: TaskId, cycleId: TaskCycleId): Promise<number> {
    return (
      this.database
        .query<{ revision: number }, [string, string]>(
          "SELECT coalesce(max(revision),0)+1 AS revision FROM spec_revisions WHERE task_id=? AND cycle_id=?",
        )
        .get(taskId, cycleId)?.revision ?? 1
    );
  }
  async insert(value: SpecRevision): Promise<void> {
    this.database
      .query<void, [string, string, string, number, string, string]>(
        "INSERT INTO spec_revisions(id,task_id,cycle_id,revision,content,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(value.id, value.taskId, value.cycleId, value.revision, value.content, value.createdAt);
  }
}

export class SqliteQuestionAnswerRepository implements QuestionAnswerStore {
  constructor(private readonly database: Database) {}
  async listByQuestionId(questionId: QuestionId): Promise<readonly QuestionAnswerSnapshot[]> {
    return this.database
      .query<QuestionAnswerRow, [string]>(
        "SELECT * FROM question_answers WHERE question_id=? ORDER BY revision ASC",
      )
      .all(questionId)
      .map(answerFromRow);
  }
  async nextRevision(questionId: QuestionId): Promise<number> {
    return (
      this.database
        .query<{ revision: number }, [string]>(
          "SELECT coalesce(max(revision),0)+1 AS revision FROM question_answers WHERE question_id=?",
        )
        .get(questionId)?.revision ?? 1
    );
  }
  async insert(value: QuestionAnswerSnapshot): Promise<void> {
    this.database
      .query<void, [string, string, string, number, string | null, string, string]>(
        "INSERT INTO question_answers(id,question_id,cycle_id,revision,answer_text,selected_option_ids_json,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        value.id,
        value.questionId,
        value.cycleId,
        value.revision,
        value.answerText,
        JSON.stringify(value.selectedOptionIds),
        value.createdAt,
      );
  }
}

export class SqliteDeliveryRepository implements DeliveryStore {
  constructor(private readonly database: Database) {}
  async getById(id: DeliveryId): Promise<Delivery | null> {
    const row = this.database
      .query<DeliveryRow, [string]>("SELECT * FROM deliveries WHERE id=?")
      .get(id);
    return row === null ? null : deliveryFromRow(row);
  }
  async insert(value: Delivery): Promise<void> {
    this.database
      .query<
        void,
        [
          string,
          string,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          number,
          number,
          number,
          string | null,
          string | null,
          string | null,
          string,
          string,
        ]
      >(
        `INSERT INTO deliveries(
           id,task_id,branch_name,base_branch,pr_url,pr_state,checks_state,
           checks_passed,checks_failed,checks_pending,external_updated_at,
           last_synchronized_at,synchronization_error,created_at,updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        value.id,
        value.taskId,
        value.branchName,
        value.baseBranch,
        value.prUrl,
        value.prState,
        value.checksState,
        value.checksPassed,
        value.checksFailed,
        value.checksPending,
        value.externalUpdatedAt,
        value.lastSynchronizedAt,
        value.synchronizationError,
        value.createdAt,
        value.updatedAt,
      );
  }
  async update(value: Delivery): Promise<void> {
    this.database
      .query<
        void,
        [
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          number,
          number,
          number,
          string | null,
          string | null,
          string | null,
          string,
          string,
        ]
      >(
        `UPDATE deliveries SET branch_name=?,base_branch=?,pr_url=?,pr_state=?,checks_state=?,
         checks_passed=?,checks_failed=?,checks_pending=?,external_updated_at=?,
         last_synchronized_at=?,synchronization_error=?,updated_at=? WHERE id=?`,
      )
      .run(
        value.branchName,
        value.baseBranch,
        value.prUrl,
        value.prState,
        value.checksState,
        value.checksPassed,
        value.checksFailed,
        value.checksPending,
        value.externalUpdatedAt,
        value.lastSynchronizedAt,
        value.synchronizationError,
        value.updatedAt,
        value.id,
      );
  }
}

export class SqliteTimelineRepository implements TimelineStore {
  constructor(private readonly database: Database) {}
  async list(taskId: TaskId, limit: number, cursor?: string) {
    assertPageLimit(limit);
    const context: CursorContext = {
      sort: "created_at",
      order: "desc",
      filter: { taskId },
    };
    const before = cursor === undefined ? null : decodeCursor(cursor, context);
    const messages = this.database
      .query<TaskMessageRow, [string]>("SELECT * FROM task_messages WHERE task_id=?")
      .all(taskId)
      .map((row) => ({ kind: "message", ...messageFromRow(row) }) as TimelineItem);
    const specs = this.database
      .query<SpecRevisionRow, [string]>("SELECT * FROM spec_revisions WHERE task_id=?")
      .all(taskId)
      .map((row) => ({ kind: "spec_revision", ...specFromRow(row) }) as TimelineItem);
    const questions = this.database
      .query<QuestionRow, [string]>("SELECT * FROM questions WHERE task_id=?")
      .all(taskId)
      .map(
        (row) =>
          ({
            kind: "question",
            question: questionFromRow(row),
            answers: this.database
              .query<QuestionAnswerRow, [string]>(
                "SELECT * FROM question_answers WHERE question_id=? ORDER BY revision ASC",
              )
              .all(row.id)
              .map(answerFromRow),
            cycleId: row.cycle_id as TaskCycleId,
            createdAt: row.created_at,
          }) as TimelineItem,
      );
    const runs = this.database
      .query<RunRow, [string]>("SELECT * FROM runs WHERE task_id=?")
      .all(taskId)
      .map(
        (row) =>
          ({
            kind: "run",
            run: runFromRow(row),
            cycleId: row.cycle_id as TaskCycleId,
            createdAt: row.created_at,
          }) as TimelineItem,
      );
    const events = this.database
      .query<TaskEventRow & { cycle_id: string | null }, [string]>(
        "SELECT * FROM task_events WHERE task_id=?",
      )
      .all(taskId)
      .map(
        (row) =>
          ({
            kind: "event",
            event: taskEventFromRow(row),
            cycleId: row.cycle_id as TaskCycleId | null,
            createdAt: row.created_at,
          }) as TimelineItem,
      );
    const all = [...messages, ...specs, ...questions, ...runs, ...events]
      .map((item) => ({ item, key: timelineItemKey(item) }))
      .filter(
        ({ item, key }) =>
          before === null ||
          item.createdAt < before.value ||
          (item.createdAt === before.value && key < before.id),
      )
      .sort(
        (left, right) =>
          right.item.createdAt.localeCompare(left.item.createdAt) ||
          right.key.localeCompare(left.key),
      );
    const selected = all.slice(0, limit);
    const last = selected.at(-1);
    return {
      items: selected.map(({ item }) => item).reverse(),
      nextCursor:
        all.length > limit && last !== undefined
          ? encodeCursor(context, { value: last.item.createdAt, id: last.key })
          : null,
    };
  }
}

function cycleFromRow(row: TaskCycleRow): TaskCycle {
  return {
    id: row.id as TaskCycleId,
    taskId: row.task_id as TaskId,
    number: row.number,
    deliveryId: row.delivery_id as DeliveryId | null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
function messageFromRow(row: TaskMessageRow): TaskMessage {
  return {
    id: row.id as TaskMessageId,
    taskId: row.task_id as TaskId,
    cycleId: row.cycle_id as TaskCycleId,
    type: row.type,
    text: row.text,
    createdAt: row.created_at,
  };
}
function specFromRow(row: SpecRevisionRow): SpecRevision {
  return {
    id: row.id as SpecRevisionId,
    taskId: row.task_id as TaskId,
    cycleId: row.cycle_id as TaskCycleId,
    revision: row.revision,
    content: row.content,
    createdAt: row.created_at,
  };
}

function verificationContractFromRow(
  row: VerificationContractRevisionRow,
): VerificationContractRevision {
  const commands: unknown = JSON.parse(row.commands_json);
  if (!Array.isArray(commands)) {
    throw new Error(`Verification Contract revision ${row.revision} has invalid commands.`);
  }
  return createVerificationContractRevision({
    projectId: row.project_id as ProjectId,
    revision: row.revision,
    enabled: row.enabled === 1,
    commands: commands as VerificationCommand[],
    now: row.created_at,
  });
}
function answerFromRow(row: QuestionAnswerRow): QuestionAnswerSnapshot {
  return {
    id: row.id as QuestionAnswerId,
    questionId: row.question_id as QuestionId,
    cycleId: row.cycle_id as TaskCycleId,
    revision: row.revision,
    answerText: row.answer_text,
    selectedOptionIds: JSON.parse(row.selected_option_ids_json) as QuestionOptionId[],
    createdAt: row.created_at,
  };
}
function deliveryFromRow(row: DeliveryRow): Delivery {
  return {
    id: row.id as DeliveryId,
    taskId: row.task_id as TaskId,
    branchName: row.branch_name,
    baseBranch: row.base_branch,
    prUrl: row.pr_url,
    prState: row.pr_state as Delivery["prState"],
    checksState: row.checks_state as Delivery["checksState"],
    checksPassed: row.checks_passed,
    checksFailed: row.checks_failed,
    checksPending: row.checks_pending,
    externalUpdatedAt: row.external_updated_at,
    lastSynchronizedAt: row.last_synchronized_at,
    synchronizationError: row.synchronization_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function timelineItemKey(item: TimelineItem): string {
  switch (item.kind) {
    case "message":
      return `message:${item.id}`;
    case "spec_revision":
      return `spec_revision:${item.id}`;
    case "question":
      return `question:${item.question.id}`;
    case "run":
      return `run:${item.run.id}`;
    case "event":
      return `event:${item.event.id}`;
  }
}
