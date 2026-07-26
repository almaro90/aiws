import type { Database } from "bun:sqlite";
import type { RunnerActivityStatus } from "./runner-activity.ts";

export type AttentionReason =
  | "approval_pending"
  | "questions_open"
  | "run_failed"
  | "publication_recoverable"
  | "automation_paused"
  | "connection_reauthorization"
  | "runner_unavailable"
  | "verification_failed"
  | "delivery_checks_failed";

export interface AttentionItem {
  readonly id: string;
  readonly reason: AttentionReason;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly taskId: string | null;
  readonly taskTitle: string | null;
  readonly runId: string | null;
  readonly connectionId: string | null;
  readonly explanation: string;
  readonly detectedAt: string;
  readonly nextAction: {
    readonly kind: "open_task" | "retry_publication" | "reauthorize" | "inspect_runner";
    readonly label: string;
    readonly href: string;
  };
}

interface TaskAttentionRow {
  readonly project_id: string;
  readonly project_name: string;
  readonly task_id: string;
  readonly task_title: string;
  readonly task_updated_at: string;
  readonly automation_paused: number;
  readonly ready_approval_pending: number;
  readonly open_questions: number;
  readonly run_id: string | null;
  readonly run_status: string | null;
  readonly run_error_code: string | null;
  readonly run_error_message: string | null;
  readonly run_execution_stage: string | null;
  readonly run_base_sha: string | null;
  readonly run_head_sha: string | null;
  readonly run_finished_at: string | null;
  readonly delivery_checks_state: string | null;
  readonly delivery_synchronized_at: string | null;
}

export class AttentionService {
  constructor(private readonly database: Database) {}

  list(input: {
    readonly limit: number;
    readonly cursor?: string;
    readonly runner: RunnerActivityStatus;
  }): { readonly items: readonly AttentionItem[]; readonly nextCursor: string | null } {
    const items = [
      ...this.taskItems(),
      ...this.connectionItems(),
      ...runnerItems(input.runner),
    ].sort(
      (left, right) =>
        right.detectedAt.localeCompare(left.detectedAt) || left.id.localeCompare(right.id),
    );
    const after =
      input.cursor === undefined ? items : itemsAfter(items, decodeCursor(input.cursor));
    const page = after.slice(0, input.limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor: after.length > input.limit && last !== undefined ? encodeCursor(last) : null,
    };
  }

  private taskItems(): AttentionItem[] {
    const rows = this.database
      .query<TaskAttentionRow, []>(
        `SELECT p.id AS project_id, p.name AS project_name, t.id AS task_id,
                t.title AS task_title, t.updated_at AS task_updated_at,
                t.automation_paused, t.ready_approval_pending,
                (SELECT count(*) FROM questions q
                 WHERE q.task_id = t.id AND q.status = 'open') AS open_questions,
                r.id AS run_id, r.status AS run_status, r.error_code AS run_error_code,
                r.error_message AS run_error_message, r.execution_stage AS run_execution_stage,
                r.base_sha AS run_base_sha, r.head_sha AS run_head_sha,
                r.finished_at AS run_finished_at,
                d.checks_state AS delivery_checks_state,
                d.last_synchronized_at AS delivery_synchronized_at
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN deliveries d ON d.id = t.current_delivery_id
         LEFT JOIN runs r ON r.id = (
           SELECT latest.id FROM runs latest
           WHERE latest.task_id = t.id
           ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
         )
         WHERE t.archived_at IS NULL AND p.archived_at IS NULL`,
      )
      .all();
    return rows.flatMap((row) => {
      const reason = taskReason(row);
      if (reason === null) return [];
      const publication = reason === "publication_recoverable";
      return [
        {
          id: `attention:task:${row.task_id}`,
          reason,
          projectId: row.project_id,
          projectName: row.project_name,
          taskId: row.task_id,
          taskTitle: row.task_title,
          runId: row.run_id,
          connectionId: null,
          explanation: taskExplanation(reason, row),
          detectedAt: row.delivery_synchronized_at ?? row.run_finished_at ?? row.task_updated_at,
          nextAction: {
            kind: publication ? "retry_publication" : "open_task",
            label: publication ? "Reintentar publicación" : "Revisar Task",
            href: `/tasks/${row.task_id}`,
          },
        } satisfies AttentionItem,
      ];
    });
  }

  private connectionItems(): AttentionItem[] {
    return this.database
      .query<
        {
          readonly id: string;
          readonly display_name: string;
          readonly updated_at: string;
        },
        []
      >(
        "SELECT id, display_name, updated_at FROM connections WHERE status = 'reauthorization_required' ORDER BY updated_at DESC, id ASC",
      )
      .all()
      .map((row) => ({
        id: `attention:connection:${row.id}`,
        reason: "connection_reauthorization",
        projectId: null,
        projectName: row.display_name,
        taskId: null,
        taskTitle: null,
        runId: null,
        connectionId: row.id,
        explanation: "La Connection requiere autorización antes de volver a operar.",
        detectedAt: row.updated_at,
        nextAction: {
          kind: "reauthorize",
          label: "Reautorizar",
          href: "/projects",
        },
      }));
  }
}

function taskReason(row: TaskAttentionRow): AttentionReason | null {
  if (row.ready_approval_pending === 1) return "approval_pending";
  if (row.open_questions > 0) return "questions_open";
  if (row.run_status === "failed" && row.run_error_code === "verification_failed")
    return "verification_failed";
  if (
    row.run_status === "failed" &&
    row.run_execution_stage === "publishing" &&
    row.run_base_sha !== null &&
    row.run_head_sha !== null
  )
    return "publication_recoverable";
  if (row.run_status === "failed") return "run_failed";
  if (row.delivery_checks_state === "failed") return "delivery_checks_failed";
  if (row.automation_paused === 1) return "automation_paused";
  return null;
}

function taskExplanation(reason: AttentionReason, row: TaskAttentionRow): string {
  if (reason === "approval_pending") return "La Curator Spec espera aprobación explícita.";
  if (reason === "questions_open")
    return `${row.open_questions} Question${row.open_questions === 1 ? "" : "s"} esperan respuesta.`;
  if (reason === "verification_failed")
    return row.run_error_message ?? "Una verificación obligatoria falló.";
  if (reason === "publication_recoverable")
    return "La implementación terminó, pero la publicación puede reintentarse.";
  if (reason === "run_failed") return row.run_error_message ?? "El último Run falló.";
  if (reason === "delivery_checks_failed")
    return "Los checks externos observados para la Delivery están fallando.";
  return "La automatización está pausada y requiere revisión.";
}

function runnerItems(status: RunnerActivityStatus): AttentionItem[] {
  if (status.status === "online") return [];
  return [
    {
      id: "attention:runner",
      reason: "runner_unavailable",
      projectId: null,
      projectName: null,
      taskId: null,
      taskTitle: null,
      runId: null,
      connectionId: null,
      explanation:
        status.status === "offline"
          ? "El runner no envía actividad dentro de la ventana esperada."
          : "Todavía no se ha observado actividad del runner.",
      detectedAt: status.lastSeenAt ?? "1970-01-01T00:00:00.000Z",
      nextAction: {
        kind: "inspect_runner",
        label: "Revisar runner",
        href: "/automation",
      },
    },
  ];
}

function encodeCursor(item: AttentionItem): string {
  return Buffer.from(JSON.stringify([item.detectedAt, item.id]), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): readonly [string, string] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      typeof value[1] === "string"
    )
      return [value[0], value[1]];
  } catch {
    // Mapped to the same stable client error below.
  }
  throw new Error("Invalid attention cursor.");
}

function itemsAfter(
  items: readonly AttentionItem[],
  cursor: readonly [string, string],
): readonly AttentionItem[] {
  const index = items.findIndex((item) => item.detectedAt === cursor[0] && item.id === cursor[1]);
  if (index < 0) throw new Error("Invalid attention cursor.");
  return items.slice(index + 1);
}
