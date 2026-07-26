import type { AgentProfileId, ConnectionId, ProjectId } from "./ids.ts";
import { assertMaximum, assertNonBlank, throwIfIssues } from "./validation.ts";
import { InvalidTransitionError, type ValidationIssue } from "../errors/domain-errors.ts";

export const GIT_PROVIDERS = ["github", "azure_devops", "gitlab", "other"] as const;
export type GitProvider = (typeof GIT_PROVIDERS)[number];

export const ACCOUNT_SCOPES = ["personal", "work"] as const;
export type AccountScope = (typeof ACCOUNT_SCOPES)[number];

export const READY_POLICIES = ["curator_decides", "manual_approval_required"] as const;
export type ReadyPolicy = (typeof READY_POLICIES)[number];

export function isValidGitBranchName(value: string): boolean {
  if (value.length === 0 || value.length > 255 || value === "@" || value.startsWith("-"))
    return false;
  const hasForbiddenCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 32 || codePoint === 127 || "~^:?*[\\".includes(character);
  });
  if (
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.includes("//") ||
    value.includes("..") ||
    value.includes("@{") ||
    hasForbiddenCharacter
  )
    return false;
  return value.split("/").every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly description: string;
  readonly repositoryPath: string;
  readonly gitProvider: GitProvider;
  readonly accountScope: AccountScope;
  readonly repositoryMode: "local" | "managed";
  readonly connectionId: ConnectionId | null;
  readonly remoteRepositoryId: string | null;
  readonly remoteFullName: string | null;
  readonly remoteWebUrl: string | null;
  readonly defaultBranch: string | null;
  readonly automationEnabled: boolean;
  readonly curationAgentProfileId: AgentProfileId | null;
  readonly implementationAgentProfileId: AgentProfileId | null;
  readonly scheduleCron: string | null;
  readonly scheduleTimezone: string;
  readonly maxConcurrency: number;
  readonly readyPolicy: ReadyPolicy;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export interface NewProject {
  readonly id: ProjectId;
  readonly name: string;
  readonly description?: string;
  readonly repositoryPath: string;
  readonly gitProvider: GitProvider;
  readonly accountScope: AccountScope;
  readonly repositoryMode?: "local" | "managed";
  readonly connectionId?: ConnectionId | null;
  readonly remoteRepositoryId?: string | null;
  readonly remoteFullName?: string | null;
  readonly remoteWebUrl?: string | null;
  readonly defaultBranch?: string | null;
  readonly automationEnabled?: boolean;
  readonly curationAgentProfileId?: AgentProfileId | null;
  readonly implementationAgentProfileId?: AgentProfileId | null;
  readonly scheduleCron?: string | null;
  readonly scheduleTimezone?: string;
  readonly maxConcurrency?: number;
  readonly readyPolicy?: ReadyPolicy;
  readonly now: string;
}

export type ProjectChanges = Partial<
  Pick<
    Project,
    | "name"
    | "description"
    | "repositoryPath"
    | "gitProvider"
    | "accountScope"
    | "automationEnabled"
    | "defaultBranch"
    | "curationAgentProfileId"
    | "implementationAgentProfileId"
    | "scheduleCron"
    | "scheduleTimezone"
    | "maxConcurrency"
    | "readyPolicy"
  >
>;

export function createProject(input: NewProject): Project {
  const description = input.description ?? "";
  const normalized = {
    ...input,
    description,
    repositoryMode: input.repositoryMode ?? "local",
    connectionId: input.connectionId ?? null,
    remoteRepositoryId: input.remoteRepositoryId ?? null,
    remoteFullName: input.remoteFullName ?? null,
    remoteWebUrl: input.remoteWebUrl ?? null,
    defaultBranch: input.defaultBranch ?? null,
    automationEnabled: input.automationEnabled ?? false,
    curationAgentProfileId: input.curationAgentProfileId ?? null,
    implementationAgentProfileId: input.implementationAgentProfileId ?? null,
    scheduleCron: input.scheduleCron ?? null,
    scheduleTimezone: input.scheduleTimezone ?? "UTC",
    maxConcurrency: input.maxConcurrency ?? 1,
    readyPolicy: input.readyPolicy ?? "curator_decides",
  };
  validateProjectFields(normalized);
  return {
    ...normalized,
    description,
    createdAt: input.now,
    updatedAt: input.now,
    archivedAt: null,
  };
}

export function updateProject(project: Project, changes: ProjectChanges, now: string): Project {
  assertProjectActive(project);
  const keys = Object.keys(changes);
  const allowedFields = [
    "name",
    "description",
    "repositoryPath",
    "gitProvider",
    "accountScope",
    "automationEnabled",
    "defaultBranch",
    "curationAgentProfileId",
    "implementationAgentProfileId",
    "scheduleCron",
    "scheduleTimezone",
    "maxConcurrency",
    "readyPolicy",
  ] as const;
  const unknownField = keys.find((field) => !(allowedFields as readonly string[]).includes(field));
  if (unknownField !== undefined) {
    throwIfIssues([{ path: unknownField, message: "Field cannot be changed." }]);
  }
  if (keys.length === 0) {
    throwIfIssues([{ path: "changes", message: "At least one field is required." }]);
  }
  if (
    project.repositoryMode === "managed" &&
    (changes.repositoryPath !== undefined || changes.gitProvider !== undefined)
  ) {
    throwIfIssues([
      { path: "repositoryPath", message: "Managed repository identity cannot be changed." },
    ]);
  }
  const updated: Project = {
    ...project,
    ...(changes.name === undefined ? {} : { name: changes.name }),
    ...(changes.description === undefined ? {} : { description: changes.description }),
    ...(changes.repositoryPath === undefined ? {} : { repositoryPath: changes.repositoryPath }),
    ...(changes.gitProvider === undefined ? {} : { gitProvider: changes.gitProvider }),
    ...(changes.accountScope === undefined ? {} : { accountScope: changes.accountScope }),
    ...(changes.automationEnabled === undefined
      ? {}
      : { automationEnabled: changes.automationEnabled }),
    ...(changes.defaultBranch === undefined ? {} : { defaultBranch: changes.defaultBranch }),
    ...(changes.curationAgentProfileId === undefined
      ? {}
      : { curationAgentProfileId: changes.curationAgentProfileId }),
    ...(changes.implementationAgentProfileId === undefined
      ? {}
      : { implementationAgentProfileId: changes.implementationAgentProfileId }),
    ...(changes.scheduleCron === undefined ? {} : { scheduleCron: changes.scheduleCron }),
    ...(changes.scheduleTimezone === undefined
      ? {}
      : { scheduleTimezone: changes.scheduleTimezone }),
    ...(changes.maxConcurrency === undefined ? {} : { maxConcurrency: changes.maxConcurrency }),
    ...(changes.readyPolicy === undefined ? {} : { readyPolicy: changes.readyPolicy }),
    updatedAt: now,
  };
  validateProjectFields(updated);
  return updated;
}

export function archiveProject(project: Project, now: string): Project {
  if (project.archivedAt !== null) return project;
  return { ...project, archivedAt: now, updatedAt: now };
}

export function unarchiveProject(project: Project, now: string): Project {
  if (project.archivedAt === null) return project;
  return { ...project, archivedAt: null, updatedAt: now };
}

export function assertProjectActive(project: Project): void {
  if (project.archivedAt !== null) {
    throw new InvalidTransitionError("Archived Project is read-only.", {
      projectId: project.id,
    });
  }
}

function validateProjectFields(
  project: Pick<
    Project,
    | "name"
    | "description"
    | "repositoryPath"
    | "gitProvider"
    | "accountScope"
    | "repositoryMode"
    | "connectionId"
    | "remoteRepositoryId"
    | "remoteFullName"
    | "remoteWebUrl"
    | "defaultBranch"
    | "automationEnabled"
    | "curationAgentProfileId"
    | "implementationAgentProfileId"
    | "scheduleCron"
    | "scheduleTimezone"
    | "maxConcurrency"
    | "readyPolicy"
  >,
): void {
  const issues: ValidationIssue[] = [];
  assertNonBlank(project.name, "name", 120, issues);
  assertMaximum(project.description, "description", 10_000, issues);
  if (!project.repositoryPath.startsWith("/")) {
    issues.push({ path: "repositoryPath", message: "Must be an absolute path." });
  }
  if (!(GIT_PROVIDERS as readonly string[]).includes(project.gitProvider)) {
    issues.push({ path: "gitProvider", message: "Unsupported Git provider." });
  }
  if (!(ACCOUNT_SCOPES as readonly string[]).includes(project.accountScope)) {
    issues.push({ path: "accountScope", message: "Unsupported account scope." });
  }
  if (!(READY_POLICIES as readonly string[]).includes(project.readyPolicy)) {
    issues.push({ path: "readyPolicy", message: "Unsupported Ready policy." });
  }
  if (project.repositoryMode === "managed") {
    for (const [path, value] of [
      ["connectionId", project.connectionId],
      ["remoteRepositoryId", project.remoteRepositoryId],
      ["remoteFullName", project.remoteFullName],
      ["remoteWebUrl", project.remoteWebUrl],
      ["defaultBranch", project.defaultBranch],
    ] as const) {
      if (value === null || value.trim() === "")
        issues.push({ path, message: "Is required for a managed repository." });
    }
    if (project.defaultBranch !== null) {
      assertNonBlank(project.defaultBranch, "defaultBranch", 255, issues);
      if (!isValidGitBranchName(project.defaultBranch)) {
        issues.push({ path: "defaultBranch", message: "Must be a valid Git branch name." });
      }
    }
  } else {
    if (project.connectionId !== null || project.remoteRepositoryId !== null) {
      issues.push({
        path: "repositoryMode",
        message: "Local repositories cannot reference a Connection.",
      });
    }
    if (project.defaultBranch !== null) {
      issues.push({
        path: "defaultBranch",
        message: "Local repositories cannot configure a managed Base Branch.",
      });
    }
  }
  if (project.automationEnabled && project.implementationAgentProfileId === null)
    issues.push({
      path: "implementationAgentProfileId",
      message: "Is required when automation is enabled.",
    });
  if (project.scheduleCron !== null && !/^\S+(?:\s+\S+){4}$/u.test(project.scheduleCron))
    issues.push({ path: "scheduleCron", message: "Must contain five cron fields." });
  if (
    !Number.isSafeInteger(project.maxConcurrency) ||
    project.maxConcurrency < 1 ||
    project.maxConcurrency > 16
  )
    issues.push({ path: "maxConcurrency", message: "Must be between 1 and 16." });
  try {
    new Intl.DateTimeFormat("en", { timeZone: project.scheduleTimezone });
  } catch {
    issues.push({ path: "scheduleTimezone", message: "Must be a valid IANA timezone." });
  }
  throwIfIssues(issues);
}
