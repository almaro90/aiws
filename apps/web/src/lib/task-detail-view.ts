import type { Run, Task, TaskStatus, TimelineItem } from "./types.ts";

export const activeRunStatuses: readonly Run["status"][] = [
  "queued",
  "preparing",
  "running",
  "publishing",
];

export function isActiveRunStatus(status: Run["status"]): boolean {
  return activeRunStatuses.includes(status);
}

export function selectRelevantRun(runs: readonly Run[], currentCycleId: string): Run | null {
  const currentCycleRuns = runs.filter((run) => run.cycleId === currentCycleId);
  return (
    currentCycleRuns.find((run) => isActiveRunStatus(run.status)) ??
    currentCycleRuns.find((run) => run.status === "failed" || run.status === "cancelled") ??
    null
  );
}

export function cycleNumberMap(
  currentCycle: Task["currentCycle"],
  items: readonly TimelineItem[],
): ReadonlyMap<string, number> {
  const orderedIds: string[] = [];
  const numbers = new Map<string, number>([[currentCycle.id, currentCycle.number]]);
  for (const item of items) {
    if (item.cycleId !== null && !orderedIds.includes(item.cycleId)) orderedIds.push(item.cycleId);
    if (
      item.kind === "event" &&
      item.event.type === "cycle_created" &&
      typeof item.event.metadata.cycleId === "string" &&
      typeof item.event.metadata.number === "number"
    ) {
      numbers.set(item.event.metadata.cycleId, item.event.metadata.number);
    }
  }
  if (!orderedIds.includes(currentCycle.id)) orderedIds.push(currentCycle.id);
  const currentIndex = orderedIds.indexOf(currentCycle.id);
  orderedIds.forEach((id, index) => {
    if (!numbers.has(id)) numbers.set(id, currentCycle.number - (currentIndex - index));
  });
  return numbers;
}

export type PrimaryTaskAction =
  | { readonly kind: "restore"; readonly label: "Restaurar Task" }
  | { readonly kind: "answer"; readonly label: "Responder Questions" }
  | { readonly kind: "message"; readonly label: "Solicitar cambio" }
  | {
      readonly kind: "transition";
      readonly label: string;
      readonly nextStatus: TaskStatus;
    }
  | null;

export function primaryTaskAction(task: Task): PrimaryTaskAction {
  if (task.archivedAt) return { kind: "restore", label: "Restaurar Task" };
  if (task.status === "blocked") return { kind: "answer", label: "Responder Questions" };
  if (task.status === "done") return { kind: "message", label: "Solicitar cambio" };
  const nextStatus =
    task.status === "draft"
      ? "curating"
      : task.status === "curating"
        ? "ready"
        : task.status === "ready"
          ? "implementing"
          : task.status === "implementing"
            ? "done"
            : null;
  if (nextStatus === null) return null;
  return {
    kind: "transition",
    nextStatus,
    label:
      nextStatus === "curating"
        ? "Enviar a curator"
        : nextStatus === "ready"
          ? "Marcar Ready"
          : nextStatus === "implementing"
            ? "Claim Task"
            : "Completar Task",
  };
}

const eventLabels: Readonly<Record<string, string>> = {
  task_created: "Task creada",
  task_updated: "Task actualizada",
  spec_updated: "Curator Spec actualizada",
  status_changed: "Estado cambiado",
  question_created: "Question creada",
  question_updated: "Question actualizada",
  question_answered: "Question respondida",
  question_dismissed: "Question descartada",
  question_reopened: "Question reabierta",
  attachment_added: "Attachment añadido",
  attachment_removed: "Attachment eliminado",
  pr_url_updated: "PR URL actualizada",
  task_archived: "Task archivada",
  task_unarchived: "Task restaurada",
  run_started: "Run iniciado",
  run_succeeded: "Run completado",
  run_failed: "Run fallido",
  run_cancelled: "Run cancelado",
  cycle_created: "Cycle creado",
  message_created: "Mensaje añadido",
  spec_revision_created: "Revisión de spec creada",
  delivery_created: "Delivery creada",
  delivery_updated: "Delivery actualizada",
};

const actorLabels: Readonly<Record<string, string>> = {
  web: "Web",
  cli: "CLI",
  system: "Sistema",
};

const safeMetadataKeys = new Set([
  "taskVersion",
  "fields",
  "length",
  "sha256",
  "from",
  "to",
  "automatic",
  "reason",
  "present",
  "questionId",
  "questionType",
  "optionCount",
  "allowOther",
  "attachmentId",
  "originalName",
  "mimeType",
  "sizeBytes",
  "runId",
  "cycleId",
  "number",
  "messageId",
  "messageType",
  "attachmentCount",
  "specRevisionId",
  "revision",
  "deliveryId",
]);

export interface EventPresentation {
  readonly label: string;
  readonly actor: string;
  readonly summary: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export function presentTaskEvent(event: {
  readonly type: string;
  readonly actorType: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}): EventPresentation {
  const from = typeof event.metadata.from === "string" ? event.metadata.from : null;
  const to = typeof event.metadata.to === "string" ? event.metadata.to : null;
  const reason = typeof event.metadata.reason === "string" ? event.metadata.reason : null;
  const summary = [from !== null && to !== null ? `${from} → ${to}` : null, reason]
    .filter((value): value is string => value !== null)
    .join(" · ");
  return {
    label: eventLabels[event.type] ?? "Actividad registrada",
    actor: actorLabels[event.actorType] ?? "Actor desconocido",
    summary: summary || null,
    metadata: Object.fromEntries(
      Object.entries(event.metadata).filter(([key]) => safeMetadataKeys.has(key)),
    ),
  };
}

export interface RunLogRow {
  readonly id: string;
  readonly label: string;
  readonly detail: string | null;
  readonly raw: string;
}

export function parseRunLogRows(value: string): RunLogRow[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          const record = parsed as Record<string, unknown>;
          const label =
            typeof record.type === "string"
              ? record.type
              : typeof record.event === "string"
                ? record.event
                : `Evento ${index + 1}`;
          const detail =
            typeof record.message === "string"
              ? record.message
              : typeof record.summary === "string"
                ? record.summary
                : null;
          return { id: `${index}-${label}`, label, detail, raw: JSON.stringify(parsed, null, 2) };
        }
      } catch {
        // A non-JSON diagnostic is still a valid log row.
      }
      return {
        id: `${index}-diagnostic`,
        label: `Diagnóstico ${index + 1}`,
        detail: line,
        raw: line,
      };
    });
}
