import type { ConnectionUseCases, Delivery } from "@aiws/core";
import type { Database } from "bun:sqlite";
import type { ManagedGitProviderRegistry } from "./integrations/managed-git-provider.ts";

interface DeliveryContextRow {
  readonly id: string;
  readonly task_id: string;
  readonly branch_name: string | null;
  readonly base_branch: string | null;
  readonly pr_url: string | null;
  readonly pr_state: Delivery["prState"];
  readonly checks_state: Delivery["checksState"];
  readonly checks_passed: number;
  readonly checks_failed: number;
  readonly checks_pending: number;
  readonly external_updated_at: string | null;
  readonly last_synchronized_at: string | null;
  readonly synchronization_error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly connection_id: string | null;
  readonly remote_full_name: string | null;
  readonly remote_repository_id: string | null;
  readonly head_sha: string | null;
}

export class DeliveryProjectionService {
  constructor(
    private readonly database: Database,
    private readonly connections: ConnectionUseCases,
    private readonly providers: ManagedGitProviderRegistry,
    private readonly coordinate: <T>(work: () => Promise<T> | T) => Promise<T>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(deliveryId: string): Promise<Delivery | null> {
    return this.coordinate(() => {
      const row = this.row(deliveryId);
      return row === null ? null : delivery(row);
    });
  }

  async refresh(deliveryId: string): Promise<Delivery> {
    const context = await this.coordinate(() => this.row(deliveryId));
    if (context === null) throw new Error("Delivery was not found.");
    if (
      context.pr_url === null ||
      context.connection_id === null ||
      context.remote_full_name === null ||
      context.remote_repository_id === null
    )
      throw new Error("Delivery has no managed pull request to synchronize.");
    try {
      const connection = await this.connections.get(context.connection_id as never);
      if (connection.status !== "active") throw new Error("Connection requires reauthorization.");
      const observation = await this.providers
        .resolve(connection)
        .observeDelivery(
          connection,
          context.remote_full_name,
          context.remote_repository_id,
          context.pr_url,
          context.head_sha,
        );
      const synchronizedAt = this.now().toISOString();
      return this.coordinate(() => {
        this.database
          .query<
            void,
            [string, string, number, number, number, string | null, string, string, string]
          >(
            `UPDATE deliveries SET pr_state=?, checks_state=?, checks_passed=?, checks_failed=?,
             checks_pending=?, external_updated_at=?, last_synchronized_at=?,
             synchronization_error=NULL, updated_at=? WHERE id=?`,
          )
          .run(
            observation.prState,
            observation.checksState,
            observation.checksPassed,
            observation.checksFailed,
            observation.checksPending,
            observation.externalUpdatedAt,
            synchronizedAt,
            synchronizedAt,
            deliveryId,
          );
        const updated = this.row(deliveryId);
        if (updated === null) throw new Error("Delivery disappeared during synchronization.");
        return delivery(updated);
      });
    } catch (error) {
      const safe = safeError(error);
      await this.coordinate(() => {
        this.database
          .query<void, [string, string, string]>(
            "UPDATE deliveries SET synchronization_error=?, updated_at=? WHERE id=?",
          )
          .run(safe, this.now().toISOString(), deliveryId);
      });
      throw new DeliverySynchronizationError(safe);
    }
  }

  private row(deliveryId: string): DeliveryContextRow | null {
    return this.database
      .query<DeliveryContextRow, [string]>(
        `SELECT d.*, p.connection_id, p.remote_full_name, p.remote_repository_id,
                (SELECT r.head_sha FROM runs r
                 WHERE r.delivery_id = d.id AND r.head_sha IS NOT NULL
                 ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS head_sha
         FROM deliveries d
         JOIN tasks t ON t.id = d.task_id
         JOIN projects p ON p.id = t.project_id
         WHERE d.id = ?`,
      )
      .get(deliveryId);
  }
}

export class DeliverySynchronizationError extends Error {}

function delivery(row: DeliveryContextRow): Delivery {
  return {
    id: row.id as Delivery["id"],
    taskId: row.task_id as Delivery["taskId"],
    branchName: row.branch_name,
    baseBranch: row.base_branch,
    prUrl: row.pr_url,
    prState: row.pr_state,
    checksState: row.checks_state,
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

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Delivery synchronization failed.")
    .replaceAll(/(?:gh[psu]_|sk-)[A-Za-z0-9_-]+/gu, "[REDACTED]")
    .replaceAll(/(password|token|secret|authorization)=\\?["']?[^\s"'\\]+/giu, "$1=[REDACTED]")
    .slice(0, 2_000);
}
