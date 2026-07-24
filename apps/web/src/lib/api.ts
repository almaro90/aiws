import type {
  Attachment,
  Project,
  ProjectPage,
  Question,
  Session,
  Task,
  TaskEventPage,
  TaskPage,
  Connection,
  RemoteRepository,
  RemoteBranch,
  AgentProfile,
  ModelCatalog,
  Run,
  RunnerStatus,
  TimelinePage,
  NotificationSettings,
} from "./types.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function mapApiError(status: number, body: unknown): ApiError {
  if (isRecord(body) && isRecord(body.error)) {
    const error = body.error;
    return new ApiError(
      status,
      typeof error.code === "string" ? error.code : "unknown_error",
      typeof error.message === "string" ? error.message : "The request failed.",
      typeof error.requestId === "string" ? error.requestId : null,
      isRecord(error.details) ? error.details : {},
    );
  }
  return new ApiError(status, "unknown_error", "The request failed.", null);
}

export function apiFieldMessage(error: unknown, path: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const fields = error.details.fields;
  if (!Array.isArray(fields)) return undefined;
  for (const field of fields) {
    if (isRecord(field) && field.path === path && typeof field.message === "string") {
      return field.message;
    }
  }
  return undefined;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      credentials: "same-origin",
      headers: {
        ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, "network_error", "No se pudo conectar con la API.", null);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    handleUnauthorized(response.status, path);
    throw mapApiError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function requestText(path: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network_error", "No se pudo conectar con la API.", null);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    handleUnauthorized(response.status, path);
    throw mapApiError(response.status, body);
  }
  return response.text();
}

const unauthorizedRedirectExclusions = new Set(["/auth/login", "/auth/session"]);

export function unauthorizedRedirect(
  status: number,
  path: string,
  location: Pick<Location, "pathname" | "search" | "hash">,
): string | null {
  if (status !== 401 || unauthorizedRedirectExclusions.has(path)) return null;
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  return `/login?redirect=${encodeURIComponent(returnTo)}`;
}

function handleUnauthorized(status: number, path: string): void {
  if (typeof window === "undefined") return;
  const target = unauthorizedRedirect(status, path, window.location);
  if (target !== null) window.location.replace(target);
}

function json(method: string, body?: unknown, version?: number): RequestInit {
  return {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(version === undefined ? {} : { headers: { "If-Match": `"${version}"` } }),
  };
}

export const api = {
  health: () => request<{ status: "ok" | "unhealthy"; version: string }>("/health"),
  runnerStatus: () => request<RunnerStatus>("/system/runner"),
  notificationSettings: () => request<NotificationSettings>("/notification-settings"),
  updateNotificationSettings: (input: unknown) =>
    request<NotificationSettings>("/notification-settings", json("PATCH", input)),
  testNotifications: () => request<void>("/notification-settings/test", json("POST")),
  session: () => request<Session>("/auth/session"),
  login: (input: { username: string; password: string }) =>
    request<void>("/auth/login", json("POST", input)),
  logout: () => request<void>("/auth/logout", json("POST")),
  projects: (query = "") => request<ProjectPage>(`/projects${query}`),
  project: (id: string) => request<Project>(`/projects/${id}`),
  projectBranches: (id: string) => request<RemoteBranch[]>(`/projects/${id}/branches`),
  createProject: (input: unknown) => request<Project>("/projects", json("POST", input)),
  updateProject: (id: string, input: unknown) =>
    request<Project>(`/projects/${id}`, json("PATCH", input)),
  archiveProject: (id: string) => request<Project>(`/projects/${id}/archive`, json("POST")),
  unarchiveProject: (id: string) => request<Project>(`/projects/${id}/unarchive`, json("POST")),
  tasks: (query = "") => request<TaskPage>(`/tasks${query}`),
  task: (id: string) => request<Task>(`/tasks/${id}`),
  createTask: (input: unknown) => request<Task>("/tasks", json("POST", input)),
  updateTask: (id: string, input: unknown, version: number) =>
    request<Task>(`/tasks/${id}`, json("PATCH", input, version)),
  transitionTask: (id: string, input: unknown, version: number) =>
    request<Task>(`/tasks/${id}/transition`, json("POST", input, version)),
  resumeTaskAutomation: (id: string, version: number) =>
    request<Task>(`/tasks/${id}/automation/resume`, json("POST", undefined, version)),
  archiveTask: (id: string, version: number, reason?: string) =>
    request<Task>(`/tasks/${id}/archive`, json("POST", reason ? { reason } : {}, version)),
  unarchiveTask: (id: string, version: number) =>
    request<Task>(`/tasks/${id}/unarchive`, json("POST", undefined, version)),
  createQuestion: (taskId: string, input: unknown, version: number) =>
    request<Task>(`/tasks/${taskId}/questions`, json("POST", input, version)),
  updateQuestion: (taskId: string, questionId: string, input: unknown, version: number) =>
    request<Task>(`/tasks/${taskId}/questions/${questionId}`, json("PATCH", input, version)),
  answerQuestion: (taskId: string, questionId: string, input: unknown, version: number) =>
    request<Task>(`/tasks/${taskId}/questions/${questionId}/answer`, json("POST", input, version)),
  dismissQuestion: (taskId: string, questionId: string, version: number, reason?: string) =>
    request<Task>(
      `/tasks/${taskId}/questions/${questionId}/dismiss`,
      json("POST", reason ? { reason } : {}, version),
    ),
  reopenQuestion: (taskId: string, questionId: string, version: number, reason?: string) =>
    request<Task>(
      `/tasks/${taskId}/questions/${questionId}/reopen`,
      json("POST", reason ? { reason } : {}, version),
    ),
  uploadAttachment: async (taskId: string, file: File, version: number) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ attachment: Attachment; taskVersion: number }>(
      `/tasks/${taskId}/attachments`,
      { method: "POST", body: form, headers: { "If-Match": `"${version}"` } },
    );
  },
  removeAttachment: (taskId: string, attachmentId: string, version: number) =>
    request<{ taskVersion: number }>(`/tasks/${taskId}/attachments/${attachmentId}`, {
      method: "DELETE",
      headers: { "If-Match": `"${version}"` },
    }),
  question: (taskId: string, questionId: string) =>
    request<Question>(`/tasks/${taskId}/questions/${questionId}`),
  activity: (taskId: string, cursor?: string) =>
    request<TaskEventPage>(
      `/tasks/${taskId}/activity?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  connections: () => request<Connection[]>("/connections"),
  githubInstallUrl: () =>
    request<{ url: string }>("/connections/github/install?returnTo=/automation"),
  connectionRepositories: (id: string) =>
    request<RemoteRepository[]>(`/connections/${id}/repositories`),
  importRepository: (connectionId: string, input: unknown) =>
    request<Project>(`/connections/${connectionId}/import`, json("POST", input)),
  revokeConnection: (id: string) => request<Connection>(`/connections/${id}/revoke`, json("POST")),
  agentProfiles: () => request<AgentProfile[]>("/agent-profiles"),
  agentProfileModels: (authMode: string, credentialReference: string) =>
    request<ModelCatalog>(
      "/agent-profiles/model-catalog",
      json("POST", { authMode, credentialReference }),
    ),
  createAgentProfile: (input: unknown) =>
    request<AgentProfile>("/agent-profiles", json("POST", input)),
  setAgentProfileEnabled: (id: string, enabled: boolean) =>
    request<AgentProfile>(`/agent-profiles/${id}/enabled`, json("PATCH", { enabled })),
  taskRuns: (taskId: string) => request<Run[]>(`/tasks/${taskId}/runs`),
  timeline: (taskId: string, cursor?: string) =>
    request<TimelinePage>(
      `/tasks/${taskId}/timeline?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  sendMessage: (taskId: string, text: string, files: readonly File[], version: number) => {
    const form = new FormData();
    if (text.trim()) form.set("text", text);
    for (const file of files) form.append("file", file);
    return request<{ message: unknown; taskVersion: number }>(`/tasks/${taskId}/messages`, {
      method: "POST",
      body: form,
      headers: { "If-Match": `"${version}"` },
    });
  },
  runLogs: (runId: string) => requestText(`/runs/${runId}/logs`),
  run: (runId: string) => request<Run>(`/runs/${runId}`),
  retryRun: (runId: string, version: number, mode: "auto" | "full" | "publish_only" = "auto") =>
    request<unknown>(`/runs/${runId}/retry`, json("POST", { mode }, version)),
  cancelRun: (runId: string, reason: string, version: number) =>
    request<Run>(`/runs/${runId}/cancel`, json("POST", { reason }, version)),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
