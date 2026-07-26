import type {
  AgentProfileId,
  ConnectionId,
  DeliveryId,
  ProjectId,
  RunId,
  TaskCycleId,
  TaskId,
} from "./ids.ts";
import { assertMaximum, assertNonBlank, throwIfIssues } from "./validation.ts";
import type { ValidationIssue } from "../errors/domain-errors.ts";
import type { ReadyPolicy } from "./project.ts";

export type ConnectionStatus = "active" | "reauthorization_required" | "revoked";

interface ConnectionBase {
  readonly id: ConnectionId;
  readonly host: string;
  readonly externalAccountId: string;
  readonly displayName: string;
  readonly status: ConnectionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GitHubConnection extends ConnectionBase {
  readonly provider: "github";
  readonly installationId: string;
}

export interface AzureDevOpsConnection extends ConnectionBase {
  readonly provider: "azure_devops";
  readonly organizationId: string;
  readonly organizationName: string;
}

export type Connection = GitHubConnection | AzureDevOpsConnection;

export function createConnection(
  input:
    | (Omit<GitHubConnection, "status" | "createdAt" | "updatedAt"> & { readonly now: string })
    | (Omit<AzureDevOpsConnection, "status" | "createdAt" | "updatedAt"> & {
        readonly now: string;
      }),
): Connection {
  const issues: ValidationIssue[] = [];
  assertNonBlank(input.externalAccountId, "externalAccountId", 255, issues);
  assertNonBlank(input.displayName, "displayName", 255, issues);
  if (input.provider === "github") {
    assertNonBlank(input.installationId, "installationId", 255, issues);
  } else {
    assertNonBlank(input.organizationId, "organizationId", 255, issues);
    assertNonBlank(input.organizationName, "organizationName", 255, issues);
  }
  try {
    const url = new URL(input.host);
    if (url.protocol !== "https:" || url.pathname !== "/")
      issues.push({ path: "host", message: "Must be an HTTPS origin." });
  } catch {
    issues.push({ path: "host", message: "Must be an HTTPS origin." });
  }
  throwIfIssues(issues);
  return { ...input, status: "active", createdAt: input.now, updatedAt: input.now };
}

export type AgentAuthMode = "api_key" | "chatgpt_session";
export interface AgentModel {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isDefault: boolean;
  readonly defaultReasoningEffort: string;
  readonly supportedReasoningEfforts: readonly string[];
}

export interface AgentModelCatalog {
  readonly models: readonly AgentModel[];
}

export interface AgentProfile {
  readonly id: AgentProfileId;
  readonly name: string;
  readonly runtime: "codex";
  readonly authMode: AgentAuthMode;
  readonly credentialReference: string;
  readonly model: string | null;
  readonly reasoningEffort: string | null;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createAgentProfile(
  input: Omit<AgentProfile, "enabled" | "createdAt" | "updatedAt"> & { readonly now: string },
): AgentProfile {
  const issues: ValidationIssue[] = [];
  assertNonBlank(input.name, "name", 120, issues);
  assertNonBlank(input.credentialReference, "credentialReference", 255, issues);
  if (!/^[A-Z][A-Z0-9_]*$/u.test(input.credentialReference)) {
    issues.push({ path: "credentialReference", message: "Must be an environment variable name." });
  }
  if (input.model !== null) assertMaximum(input.model, "model", 120, issues);
  if (input.reasoningEffort !== null) {
    assertMaximum(input.reasoningEffort, "reasoningEffort", 120, issues);
  }
  throwIfIssues(issues);
  return { ...input, enabled: true, createdAt: input.now, updatedAt: input.now };
}

export const RUN_STATUSES = [
  "queued",
  "preparing",
  "running",
  "verifying",
  "publishing",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export type RunKind = "curation" | "implementation";
export type RunOutcome = "ready" | "blocked" | "approval_required" | null;
export type RunExecutionStage = "agent" | "publishing";
export type RunRetryMode = "auto" | "full" | "publish_only";

export interface Run {
  readonly id: RunId;
  readonly taskId: TaskId;
  readonly cycleId: TaskCycleId;
  readonly deliveryId: DeliveryId | null;
  readonly projectId: ProjectId;
  readonly agentProfileId: AgentProfileId;
  readonly kind: RunKind;
  readonly outcome: RunOutcome;
  readonly attempt: number;
  readonly status: RunStatus;
  readonly taskVersion: number;
  readonly executionStage: RunExecutionStage;
  readonly resumeFromRunId: RunId | null;
  readonly branchName: string | null;
  readonly baseSha: string | null;
  readonly headSha: string | null;
  readonly prUrl: string | null;
  readonly summary: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly logsStorageKey: string | null;
  readonly heartbeatAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly readyPolicy: ReadyPolicy | null;
  readonly verificationContractRevision: number | null;
  readonly verificationWaiverRunId: RunId | null;
  readonly verificationWaiverReason: string | null;
}

export function createRun(
  input: Pick<
    Run,
    | "id"
    | "taskId"
    | "cycleId"
    | "deliveryId"
    | "projectId"
    | "agentProfileId"
    | "kind"
    | "attempt"
    | "taskVersion"
    | "branchName"
    | "executionStage"
    | "resumeFromRunId"
    | "readyPolicy"
    | "verificationContractRevision"
  > & { readonly now: string },
): Run {
  const issues: ValidationIssue[] = [];
  if (input.kind === "implementation") {
    if (input.branchName === null) {
      issues.push({ path: "branchName", message: "Implementation Runs require a branch." });
    } else {
      assertNonBlank(input.branchName, "branchName", 255, issues);
    }
    if (input.readyPolicy !== null) {
      issues.push({ path: "readyPolicy", message: "Implementation Runs do not use Ready policy." });
    }
    if (
      input.verificationContractRevision !== null &&
      (!Number.isInteger(input.verificationContractRevision) ||
        input.verificationContractRevision < 1)
    ) {
      issues.push({
        path: "verificationContractRevision",
        message: "Verification Contract revision must be a positive integer.",
      });
    }
  } else if (input.branchName !== null) {
    issues.push({ path: "branchName", message: "Curation Runs do not use a branch." });
  } else if (input.readyPolicy === null) {
    issues.push({ path: "readyPolicy", message: "Curation Runs require a Ready policy snapshot." });
  } else if (input.verificationContractRevision !== null) {
    issues.push({
      path: "verificationContractRevision",
      message: "Curation Runs do not use a Verification Contract.",
    });
  }
  if (input.attempt < 1 || !Number.isSafeInteger(input.attempt))
    issues.push({ path: "attempt", message: "Must be a positive integer." });
  throwIfIssues(issues);
  return {
    ...input,
    status: "queued",
    outcome: null,
    baseSha: null,
    headSha: null,
    prUrl: null,
    summary: null,
    errorCode: null,
    errorMessage: null,
    logsStorageKey: null,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    verificationWaiverRunId: null,
    verificationWaiverReason: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ["preparing", "failed", "cancelled"],
  preparing: ["running", "failed", "cancelled"],
  running: ["verifying", "publishing", "failed", "cancelled"],
  verifying: ["publishing", "failed", "cancelled"],
  publishing: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function transitionRun(
  run: Run,
  status: RunStatus,
  now: string,
  details: Partial<
    Pick<
      Run,
      | "baseSha"
      | "headSha"
      | "prUrl"
      | "summary"
      | "errorCode"
      | "errorMessage"
      | "logsStorageKey"
      | "outcome"
    >
  > = {},
): Run {
  if (
    run.kind === "curation" &&
    (status === "verifying" ||
      run.status === "verifying" ||
      status === "publishing" ||
      run.status === "publishing")
  ) {
    throwIfIssues([{ path: "status", message: "Curation Runs do not publish." }]);
  }
  if (run.kind === "curation" && run.status === "running" && status === "succeeded") {
    // Curation finishes after structured output has been applied by the manager.
  } else if (!RUN_TRANSITIONS[run.status].includes(status)) {
    throwIfIssues([
      { path: "status", message: `Run transition ${run.status} -> ${status} is not allowed.` },
    ]);
  }
  const terminal = status === "succeeded" || status === "failed" || status === "cancelled";
  return {
    ...run,
    ...details,
    status,
    executionStage: status === "publishing" ? "publishing" : run.executionStage,
    heartbeatAt: terminal ? run.heartbeatAt : now,
    startedAt: run.startedAt ?? (status === "preparing" ? now : null),
    finishedAt: terminal ? now : null,
    updatedAt: now,
  };
}

export function heartbeatRun(run: Run, now: string): Run {
  if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") {
    throwIfIssues([{ path: "status", message: "A terminal Run cannot receive heartbeats." }]);
  }
  return { ...run, heartbeatAt: now, updatedAt: now };
}
