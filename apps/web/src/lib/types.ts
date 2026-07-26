import type { components } from "@aiws/api-client";

export type Project = components["schemas"]["Project"];
export type ProjectPage = components["schemas"]["ProjectPage"];
export type TaskSummary = components["schemas"]["TaskSummary"];
export type TaskPage = components["schemas"]["TaskPage"];
export type Task = components["schemas"]["TaskAggregate"];
export type TaskStatus = components["schemas"]["TaskStatus"];
export type Question = components["schemas"]["Question"];
export type QuestionType = components["schemas"]["QuestionType"];
export type Attachment = components["schemas"]["Attachment"];
export type TaskEventPage = components["schemas"]["TaskEventPage"];
export type ApiErrorBody = components["schemas"]["ErrorBody"];
export type Connection = components["schemas"]["Connection"];
export type RemoteRepository = components["schemas"]["RemoteRepository"];
export type RemoteBranch = components["schemas"]["RemoteBranch"];
export type AgentProfile = components["schemas"]["AgentProfile"];
export type ModelCatalog = components["schemas"]["ModelCatalog"];
export type Run = components["schemas"]["Run"];
export type VerificationResult = components["schemas"]["VerificationResult"];
export type RunProvenance = components["schemas"]["RunProvenance"];
export type AttentionPage = components["schemas"]["AttentionPage"];
export type TimelinePage = components["schemas"]["TimelinePage"];
export type TimelineItem = components["schemas"]["TimelineItem"];
export type RunnerStatus = components["schemas"]["RunnerStatus"];
export type ProjectReadinessReport = components["schemas"]["ProjectReadinessReport"];
export type VerificationCommand = components["schemas"]["VerificationCommand"];
export type VerificationContractRevision = components["schemas"]["VerificationContractRevision"];
export type VerificationContractState = components["schemas"]["VerificationContractState"];

export interface NotificationSettings {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly topic: string;
  readonly accessTokenConfigured: boolean;
  readonly updatedAt: string;
}

export interface Session {
  readonly authenticated: true;
  readonly username: string;
}
