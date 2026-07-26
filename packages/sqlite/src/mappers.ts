import type {
  AccountScope,
  ActorType,
  AttachmentId,
  GitProvider,
  Project,
  ProjectId,
  Question,
  QuestionId,
  QuestionOption,
  QuestionOptionId,
  QuestionStatus,
  QuestionType,
  Task,
  TaskEvent,
  TaskEventId,
  TaskEventType,
  TaskId,
  TaskStatus,
  TaskSummary,
  StoredAttachment,
  AgentProfile,
  AgentProfileId,
  Connection,
  ConnectionId,
  Run,
  RunId,
  RunStatus,
  RunKind,
  RunOutcome,
  TaskCycleId,
  TaskMessageId,
  DeliveryId,
} from "@aiws/core";

export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly repository_path: string;
  readonly git_provider: string;
  readonly account_scope: string;
  readonly repository_mode: string;
  readonly connection_id: string | null;
  readonly remote_repository_id: string | null;
  readonly remote_full_name: string | null;
  readonly remote_web_url: string | null;
  readonly default_branch: string | null;
  readonly automation_enabled: number;
  readonly curation_agent_profile_id: string | null;
  readonly implementation_agent_profile_id: string | null;
  readonly schedule_cron: string | null;
  readonly schedule_timezone: string;
  readonly max_concurrency: number;
  readonly ready_policy: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
}

export interface TaskRow {
  readonly id: string;
  readonly project_id: string;
  readonly title: string;
  readonly user_request: string;
  readonly curator_spec: string;
  readonly status: string;
  readonly pr_url: string | null;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
  readonly automation_paused: number;
  readonly current_cycle_id: string;
  readonly current_delivery_id: string | null;
  readonly ready_approval_pending: number;
}

export interface TaskSummaryRow {
  readonly id: string;
  readonly project_id: string;
  readonly project_name: string;
  readonly title: string;
  readonly status: string;
  readonly version: number;
  readonly pr_url: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
}

export interface TaskEventRow {
  readonly id: string;
  readonly task_id: string;
  readonly type: string;
  readonly actor_type: string;
  readonly metadata_json: string;
  readonly created_at: string;
}

export interface QuestionRow {
  readonly id: string;
  readonly task_id: string;
  readonly cycle_id: string;
  readonly text: string;
  readonly type: string;
  readonly options_json: string;
  readonly allow_other: number;
  readonly answer_text: string | null;
  readonly selected_option_ids_json: string;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly answered_at: string | null;
  readonly dismissed_at: string | null;
}

export interface AttachmentRow {
  readonly id: string;
  readonly task_id: string;
  readonly cycle_id: string;
  readonly message_id: string | null;
  readonly original_name: string;
  readonly storage_key: string;
  readonly mime_type: string;
  readonly size_bytes: number;
  readonly sha256: string;
  readonly created_at: string;
}

export interface ConnectionRow {
  readonly id: string;
  readonly provider: string;
  readonly host: string;
  readonly external_account_id: string;
  readonly display_name: string;
  readonly installation_id: string | null;
  readonly organization_id: string | null;
  readonly organization_name: string | null;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AgentProfileRow {
  readonly id: string;
  readonly name: string;
  readonly runtime: string;
  readonly auth_mode: string;
  readonly credential_reference: string;
  readonly model: string | null;
  readonly reasoning_effort: string | null;
  readonly enabled: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface RunRow {
  readonly id: string;
  readonly task_id: string;
  readonly cycle_id: string;
  readonly delivery_id: string | null;
  readonly project_id: string;
  readonly agent_profile_id: string;
  readonly kind: string;
  readonly outcome: string | null;
  readonly attempt: number;
  readonly status: string;
  readonly task_version: number;
  readonly execution_stage: string;
  readonly resume_from_run_id: string | null;
  readonly branch_name: string | null;
  readonly base_sha: string | null;
  readonly head_sha: string | null;
  readonly pr_url: string | null;
  readonly summary: string | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly logs_storage_key: string | null;
  readonly heartbeat_at: string | null;
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly ready_policy: string | null;
  readonly verification_contract_revision: number | null;
  readonly verification_waiver_run_id: string | null;
  readonly verification_waiver_reason: string | null;
}

export function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id as ProjectId,
    name: row.name,
    description: row.description,
    repositoryPath: row.repository_path,
    gitProvider: row.git_provider as GitProvider,
    accountScope: row.account_scope as AccountScope,
    repositoryMode: row.repository_mode as Project["repositoryMode"],
    connectionId: row.connection_id as ConnectionId | null,
    remoteRepositoryId: row.remote_repository_id,
    remoteFullName: row.remote_full_name,
    remoteWebUrl: row.remote_web_url,
    defaultBranch: row.default_branch,
    automationEnabled: row.automation_enabled === 1,
    curationAgentProfileId: row.curation_agent_profile_id as AgentProfileId | null,
    implementationAgentProfileId: row.implementation_agent_profile_id as AgentProfileId | null,
    scheduleCron: row.schedule_cron,
    scheduleTimezone: row.schedule_timezone,
    maxConcurrency: row.max_concurrency,
    readyPolicy: row.ready_policy as Project["readyPolicy"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

export function connectionFromRow(row: ConnectionRow): Connection {
  const base = {
    id: row.id as ConnectionId,
    host: row.host,
    externalAccountId: row.external_account_id,
    displayName: row.display_name,
    status: row.status as Connection["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.provider === "azure_devops") {
    if (row.organization_id === null || row.organization_name === null) {
      throw new Error("Azure DevOps Connection row is incomplete.");
    }
    return {
      ...base,
      provider: "azure_devops",
      organizationId: row.organization_id,
      organizationName: row.organization_name,
    };
  }
  if (row.installation_id === null) throw new Error("GitHub Connection row is incomplete.");
  return { ...base, provider: "github", installationId: row.installation_id };
}

export function agentProfileFromRow(row: AgentProfileRow): AgentProfile {
  return {
    id: row.id as AgentProfileId,
    name: row.name,
    runtime: "codex",
    authMode: row.auth_mode as AgentProfile["authMode"],
    credentialReference: row.credential_reference,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function runFromRow(row: RunRow): Run {
  return {
    id: row.id as RunId,
    taskId: row.task_id as TaskId,
    cycleId: row.cycle_id as TaskCycleId,
    deliveryId: row.delivery_id as DeliveryId | null,
    projectId: row.project_id as ProjectId,
    agentProfileId: row.agent_profile_id as AgentProfileId,
    kind: row.kind as RunKind,
    outcome: row.outcome as RunOutcome,
    attempt: row.attempt,
    status: row.status as RunStatus,
    taskVersion: row.task_version,
    executionStage: row.execution_stage as Run["executionStage"],
    resumeFromRunId: row.resume_from_run_id as RunId | null,
    branchName: row.branch_name,
    baseSha: row.base_sha,
    headSha: row.head_sha,
    prUrl: row.pr_url,
    summary: row.summary,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    logsStorageKey: row.logs_storage_key,
    heartbeatAt: row.heartbeat_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readyPolicy: row.ready_policy as Run["readyPolicy"],
    verificationContractRevision: row.verification_contract_revision,
    verificationWaiverRunId: row.verification_waiver_run_id as RunId | null,
    verificationWaiverReason: row.verification_waiver_reason,
  };
}

export function taskFromRow(row: TaskRow): Task {
  return {
    id: row.id as TaskId,
    projectId: row.project_id as ProjectId,
    title: row.title,
    userRequest: row.user_request,
    curatorSpec: row.curator_spec,
    status: row.status as TaskStatus,
    prUrl: row.pr_url,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    automationPaused: row.automation_paused === 1,
    currentCycleId: row.current_cycle_id as TaskCycleId,
    currentDeliveryId: row.current_delivery_id as DeliveryId | null,
    readyApprovalPending: row.ready_approval_pending === 1,
  };
}

export function taskSummaryFromRow(row: TaskSummaryRow): TaskSummary {
  return {
    id: row.id as TaskId,
    projectId: row.project_id as ProjectId,
    projectName: row.project_name,
    title: row.title,
    status: row.status as TaskStatus,
    version: row.version,
    prUrl: row.pr_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

export function taskEventFromRow(row: TaskEventRow): TaskEvent {
  const metadata: unknown = JSON.parse(row.metadata_json);
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new Error(`TaskEvent ${row.id} has invalid metadata.`);
  }
  return {
    id: row.id as TaskEventId,
    taskId: row.task_id as TaskId,
    type: row.type as TaskEventType,
    actorType: row.actor_type as ActorType,
    metadata: metadata as Readonly<Record<string, unknown>>,
    createdAt: row.created_at,
  };
}

export function questionFromRow(row: QuestionRow): Question {
  const options = JSON.parse(row.options_json) as QuestionOption[];
  const selectedOptionIds = JSON.parse(row.selected_option_ids_json) as QuestionOptionId[];
  return {
    id: row.id as QuestionId,
    taskId: row.task_id as TaskId,
    cycleId: row.cycle_id as TaskCycleId,
    text: row.text,
    type: row.type as QuestionType,
    options,
    allowOther: row.allow_other === 1,
    answerText: row.answer_text,
    selectedOptionIds,
    status: row.status as QuestionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    answeredAt: row.answered_at,
    dismissedAt: row.dismissed_at,
  };
}

export function attachmentFromRow(row: AttachmentRow): StoredAttachment {
  return {
    id: row.id as AttachmentId,
    taskId: row.task_id as TaskId,
    cycleId: row.cycle_id as TaskCycleId,
    messageId: row.message_id as TaskMessageId | null,
    originalName: row.original_name,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}
