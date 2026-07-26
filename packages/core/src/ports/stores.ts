import type { AccountScope, GitProvider, Project } from "../domain/project.ts";
import type { Attachment } from "../domain/attachment.ts";
import type { Question } from "../domain/question.ts";
import type { TaskEvent } from "../domain/task-event.ts";
import type { Task, TaskStatus } from "../domain/task.ts";
import type { AttachmentId, ProjectId, QuestionId, TaskId } from "../domain/ids.ts";
import type { AgentProfile, Connection, Run } from "../domain/automation.ts";
import type { VerificationContractRevision } from "../domain/verification.ts";
import type {
  Delivery,
  QuestionAnswer,
  SpecRevision,
  TaskCycle,
  TaskMessage,
  TimelinePage,
} from "../domain/cycle.ts";
import type {
  AgentProfileId,
  ConnectionId,
  DeliveryId,
  RunId,
  TaskCycleId,
  TaskMessageId,
} from "../domain/ids.ts";

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface ProjectListQuery {
  readonly archived: boolean;
  readonly gitProvider?: GitProvider;
  readonly accountScope?: AccountScope;
  readonly limit: number;
  readonly cursor?: string;
}

export interface TaskSummary {
  readonly id: TaskId;
  readonly projectId: ProjectId;
  readonly projectName: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly version: number;
  readonly prUrl: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export interface TaskListQuery {
  readonly projectId?: ProjectId;
  readonly statuses?: readonly TaskStatus[];
  readonly accountScope?: AccountScope;
  readonly gitProvider?: GitProvider;
  readonly archived: boolean;
  readonly sort: "updatedAt" | "createdAt";
  readonly order: "asc" | "desc";
  readonly limit: number;
  readonly cursor?: string;
}

export interface TaskEventListQuery {
  readonly taskId: TaskId;
  readonly limit: number;
  readonly cursor?: string;
}

export interface TaskAggregate extends Task {
  readonly project: Project;
  readonly questions: readonly Question[];
  readonly attachments: readonly Attachment[];
  readonly specRevisions: readonly SpecRevision[];
  readonly currentCycle: TaskCycle;
  readonly currentDelivery: Delivery | null;
}

export interface CycleStore {
  getById(id: TaskCycleId): Promise<TaskCycle | null>;
  listByTaskId(taskId: TaskId): Promise<readonly TaskCycle[]>;
  nextNumber(taskId: TaskId): Promise<number>;
  insert(cycle: TaskCycle): Promise<void>;
  update(cycle: TaskCycle): Promise<void>;
}
export interface MessageStore {
  getById(id: TaskMessageId): Promise<TaskMessage | null>;
  listByTaskId(taskId: TaskId): Promise<readonly TaskMessage[]>;
  insert(message: TaskMessage): Promise<void>;
}
export interface SpecRevisionStore {
  listByTaskId(taskId: TaskId): Promise<readonly SpecRevision[]>;
  nextRevision(taskId: TaskId, cycleId: TaskCycleId): Promise<number>;
  insert(revision: SpecRevision): Promise<void>;
}
export interface QuestionAnswerStore {
  listByQuestionId(questionId: QuestionId): Promise<readonly QuestionAnswer[]>;
  nextRevision(questionId: QuestionId): Promise<number>;
  insert(answer: QuestionAnswer): Promise<void>;
}
export interface DeliveryStore {
  getById(id: DeliveryId): Promise<Delivery | null>;
  insert(delivery: Delivery): Promise<void>;
  update(delivery: Delivery): Promise<void>;
}
export interface TimelineStore {
  list(taskId: TaskId, limit: number, cursor?: string): Promise<TimelinePage>;
}

export interface ProjectStore {
  getById(id: ProjectId): Promise<Project | null>;
  list(query: ProjectListQuery): Promise<Page<Project>>;
  repositoryPathExists(repositoryPath: string, excludingId?: ProjectId): Promise<boolean>;
  insert(project: Project): Promise<void>;
  update(project: Project): Promise<void>;
  countActiveTasks(projectId: ProjectId): Promise<number>;
}

export interface VerificationContractStore {
  getLatest(projectId: ProjectId): Promise<VerificationContractRevision | null>;
  getRevision(projectId: ProjectId, revision: number): Promise<VerificationContractRevision | null>;
  list(projectId: ProjectId): Promise<readonly VerificationContractRevision[]>;
  insert(revision: VerificationContractRevision): Promise<void>;
}

export interface TaskStore {
  getById(id: TaskId): Promise<Task | null>;
  list(query: TaskListQuery): Promise<Page<TaskSummary>>;
  insert(task: Task): Promise<void>;
  updateIfVersion(task: Task, expectedVersion: number): Promise<boolean>;
  listCurationCandidates(limit: number): Promise<readonly Task[]>;
  listAutomationCandidates(limit: number): Promise<readonly Task[]>;
}

export interface ConnectionStore {
  getById(id: ConnectionId): Promise<Connection | null>;
  list(): Promise<readonly Connection[]>;
  findByInstallation(
    provider: "github",
    host: string,
    installationId: string,
  ): Promise<Connection | null>;
  findByOrganization(
    provider: "azure_devops",
    host: string,
    organizationId: string,
  ): Promise<Connection | null>;
  insert(connection: Connection): Promise<void>;
  update(connection: Connection): Promise<void>;
}

export interface AgentProfileStore {
  getById(id: AgentProfileId): Promise<AgentProfile | null>;
  list(): Promise<readonly AgentProfile[]>;
  nameExists(name: string): Promise<boolean>;
  insert(profile: AgentProfile): Promise<void>;
  update(profile: AgentProfile): Promise<void>;
}

export interface RunStore {
  getById(id: RunId): Promise<Run | null>;
  getNextQueued(): Promise<Run | null>;
  listByTaskId(taskId: TaskId, kind?: Run["kind"]): Promise<readonly Run[]>;
  listStaleActive(before: string): Promise<readonly Run[]>;
  countActiveByProject(projectId: ProjectId): Promise<number>;
  nextAttempt(taskId: TaskId, kind: Run["kind"]): Promise<number>;
  insert(run: Run): Promise<void>;
  update(run: Run): Promise<void>;
}

export interface VerificationResultStore {
  listByRunId(
    runId: RunId,
  ): Promise<readonly import("../domain/run-evidence.ts").VerificationResult[]>;
  insertMany(
    results: readonly import("../domain/run-evidence.ts").VerificationResult[],
  ): Promise<void>;
}

export interface RunProvenanceStore {
  getByRunId(runId: RunId): Promise<import("../domain/run-evidence.ts").RunProvenance | null>;
  insert(provenance: import("../domain/run-evidence.ts").RunProvenance): Promise<void>;
}

export interface QuestionStore {
  getById(id: QuestionId): Promise<Question | null>;
  countOpenByTaskId(taskId: TaskId, cycleId?: TaskCycleId): Promise<number>;
  listByTaskId(taskId: TaskId): Promise<readonly Question[]>;
  insert(question: Question): Promise<void>;
  update(question: Question): Promise<void>;
}

export interface AttachmentMetadataStore {
  getById(id: AttachmentId): Promise<StoredAttachment | null>;
  countByTaskId(taskId: TaskId): Promise<number>;
  listByTaskId(taskId: TaskId): Promise<readonly StoredAttachment[]>;
  insert(attachment: StoredAttachment): Promise<void>;
  remove(id: AttachmentId, taskId: TaskId): Promise<boolean>;
}

export interface StoredAttachment extends Attachment {
  readonly storageKey: string;
}

export interface TaskEventStore {
  append(events: readonly TaskEvent[]): Promise<void>;
  list(query: TaskEventListQuery): Promise<Page<TaskEvent>>;
}

export interface Stores {
  readonly projects: ProjectStore;
  readonly verificationContracts: VerificationContractStore;
  readonly tasks: TaskStore;
  readonly questions: QuestionStore;
  readonly attachments: AttachmentMetadataStore;
  readonly events: TaskEventStore;
  readonly connections: ConnectionStore;
  readonly agentProfiles: AgentProfileStore;
  readonly runs: RunStore;
  readonly verificationResults: VerificationResultStore;
  readonly runProvenance: RunProvenanceStore;
  readonly cycles: CycleStore;
  readonly messages: MessageStore;
  readonly specRevisions: SpecRevisionStore;
  readonly questionAnswers: QuestionAnswerStore;
  readonly deliveries: DeliveryStore;
  readonly timeline: TimelineStore;
}
