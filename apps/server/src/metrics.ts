import type { Database } from "bun:sqlite";

interface RunMetricRow {
  readonly id: string;
  readonly task_id: string;
  readonly kind: "curation" | "implementation";
  readonly attempt: number;
  readonly status: string;
  readonly execution_stage: string;
  readonly resume_from_run_id: string | null;
  readonly verification_waiver_run_id: string | null;
  readonly started_at: string | null;
  readonly finished_at: string | null;
}

export class ProductMetricsService {
  constructor(
    private readonly database: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  project(projectId: string, from: string, to: string) {
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs)
      throw new Error("Metrics range must be two ordered UTC timestamps.");
    if (toMs - fromMs > 366 * 24 * 60 * 60_000)
      throw new Error("Metrics range cannot exceed 366 days.");
    const exists = this.database
      .query<{ readonly id: string }, [string]>("SELECT id FROM projects WHERE id = ?")
      .get(projectId);
    if (exists === null) throw new Error("Project was not found.");
    const tasks = this.database
      .query<{ readonly id: string; readonly created_at: string }, [string, string, string]>(
        "SELECT id, created_at FROM tasks WHERE project_id = ? AND created_at >= ? AND created_at < ?",
      )
      .all(projectId, from, to);
    const events = this.database
      .query<
        {
          readonly task_id: string;
          readonly type: string;
          readonly metadata_json: string;
          readonly created_at: string;
        },
        [string, string, string]
      >(
        `SELECT e.task_id, e.type, e.metadata_json, e.created_at
         FROM task_events e JOIN tasks t ON t.id = e.task_id
         WHERE t.project_id = ? AND e.created_at >= ? AND e.created_at < ?
         ORDER BY e.task_id, e.created_at, e.id`,
      )
      .all(projectId, from, to);
    const readyByTask = new Map<string, string>();
    const blockedSince = new Map<string, number>();
    let blockedDurationMs = 0;
    let blockedSamples = 0;
    for (const event of events) {
      if (event.type !== "status_changed") continue;
      const metadata = JSON.parse(event.metadata_json) as { from?: string; to?: string };
      if (metadata.to === "ready" && !readyByTask.has(event.task_id))
        readyByTask.set(event.task_id, event.created_at);
      if (metadata.to === "blocked") blockedSince.set(event.task_id, Date.parse(event.created_at));
      const blockedAt = blockedSince.get(event.task_id);
      if (blockedAt !== undefined && metadata.from === "blocked") {
        blockedDurationMs += Math.max(0, Date.parse(event.created_at) - blockedAt);
        blockedSamples += 1;
        blockedSince.delete(event.task_id);
      }
    }
    const requestToReady = tasks.flatMap((task) => {
      const ready = readyByTask.get(task.id);
      return ready === undefined
        ? []
        : [Math.max(0, Date.parse(ready) - Date.parse(task.created_at))];
    });
    const runs = this.database
      .query<RunMetricRow, [string, string, string]>(
        "SELECT r.* FROM runs r WHERE r.project_id = ? AND r.created_at >= ? AND r.created_at < ?",
      )
      .all(projectId, from, to);
    const verification = this.database
      .query<{ readonly status: string; readonly required: number }, [string, string, string]>(
        `SELECT v.status, v.required FROM verification_results v
         JOIN runs r ON r.id = v.run_id
         WHERE r.project_id = ? AND r.created_at >= ? AND r.created_at < ?`,
      )
      .all(projectId, from, to);
    const deliveries = this.database
      .query<
        {
          readonly pr_url: string | null;
          readonly pr_state: string | null;
          readonly last_synchronized_at: string | null;
        },
        [string, string, string]
      >(
        `SELECT d.pr_url, d.pr_state, d.last_synchronized_at FROM deliveries d
         JOIN tasks t ON t.id = d.task_id
         WHERE t.project_id = ? AND d.created_at >= ? AND d.created_at < ?`,
      )
      .all(projectId, from, to);
    const questions =
      this.database
        .query<{ readonly count: number }, [string, string, string]>(
          `SELECT count(*) AS count FROM questions q JOIN tasks t ON t.id = q.task_id
         WHERE t.project_id = ? AND q.created_at >= ? AND q.created_at < ?`,
        )
        .get(projectId, from, to)?.count ?? 0;
    const provenanceCount =
      this.database
        .query<{ readonly count: number }, [string, string, string]>(
          `SELECT count(*) AS count FROM run_provenance p JOIN runs r ON r.id = p.run_id
           WHERE r.project_id = ? AND r.created_at >= ? AND r.created_at < ?`,
        )
        .get(projectId, from, to)?.count ?? 0;
    const generated = this.now();
    const generatedAt = generated.toISOString();
    const staleBefore = generated.getTime() - 24 * 60 * 60_000;
    return {
      projectId,
      from,
      to,
      generatedAt,
      coverage: {
        tasks: tasks.length,
        readySamples: requestToReady.length,
        runs: runs.length,
        runsWithProvenance: provenanceCount,
        deliveries: deliveries.length,
        deliveriesObserved: deliveries.filter((item) => item.last_synchronized_at !== null).length,
        staleDeliveries: deliveries.filter(
          (item) =>
            item.last_synchronized_at === null ||
            Date.parse(item.last_synchronized_at) < staleBefore,
        ).length,
      },
      flow: {
        requestToReadyAverageMs: average(requestToReady),
        blockedDurationMs,
        blockedSamples,
        questions,
      },
      runs: {
        curation: durationMetrics(runs.filter((run) => run.kind === "curation")),
        implementation: durationMetrics(runs.filter((run) => run.kind === "implementation")),
        firstAttemptSucceeded: runs.filter((run) => run.attempt === 1 && run.status === "succeeded")
          .length,
        firstAttempts: runs.filter((run) => run.attempt === 1).length,
      },
      retries: {
        full: runs.filter(
          (run) =>
            run.attempt > 1 && run.execution_stage === "agent" && run.resume_from_run_id === null,
        ).length,
        publishOnly: runs.filter(
          (run) => run.resume_from_run_id !== null && run.verification_waiver_run_id === null,
        ).length,
        waiver: runs.filter((run) => run.verification_waiver_run_id !== null).length,
      },
      verification: {
        passed: verification.filter((item) => item.status === "passed").length,
        failed: verification.filter((item) => item.status !== "passed").length,
        requiredFailed: verification.filter(
          (item) => item.required === 1 && item.status !== "passed",
        ).length,
      },
      delivery: {
        pullRequests: deliveries.filter((item) => item.pr_url !== null).length,
        mergedObserved: deliveries.filter((item) => item.pr_state === "merged").length,
      },
    };
  }
}

function durationMetrics(runs: readonly RunMetricRow[]) {
  const values = runs.flatMap((run) =>
    run.started_at === null || run.finished_at === null
      ? []
      : [Math.max(0, Date.parse(run.finished_at) - Date.parse(run.started_at))],
  );
  return {
    count: runs.length,
    completedSamples: values.length,
    averageDurationMs: average(values),
  };
}

function average(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}
