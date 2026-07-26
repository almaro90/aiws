import { expect, test, type Page } from "@playwright/test";

const project = {
  id: "prj_01K0ABCDEFGHJKMNPQRSTVWXYZ",
  name: "AIWS",
  description: "Workspace local",
  repositoryPath: "/srv/repos/aiws",
  gitProvider: "github",
  accountScope: "personal",
  repositoryMode: "local",
  connectionId: null,
  remoteRepositoryId: null,
  remoteFullName: null,
  remoteWebUrl: null,
  defaultBranch: null,
  automationEnabled: false,
  curationAgentProfileId: null,
  implementationAgentProfileId: null,
  scheduleCron: null,
  scheduleTimezone: "UTC",
  maxConcurrency: 1,
  readyPolicy: "curator_decides",
  createdAt: "2026-07-21T10:00:00.000Z",
  updatedAt: "2026-07-21T12:00:00.000Z",
  archivedAt: null,
};

const connectionId = "con_01K0ABCDEFGHJKMNPQRSTVWXYZ";
const managedConnection = {
  id: connectionId,
  provider: "github",
  host: "https://github.com",
  externalAccountId: "installation-1",
  displayName: "AIWS GitHub",
  status: "active",
  installationId: "installation-1",
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};
const remoteRepository = {
  id: "repo-1",
  fullName: "alvaro/aiws",
  name: "aiws",
  description: "AIWS repository",
  webUrl: "https://github.com/alvaro/aiws",
  cloneUrl: "https://github.com/alvaro/aiws.git",
  defaultBranch: "main",
  private: true,
};

const taskId = "tsk_01K0ABCDEFGHJKMNPQRSTVWXYZ";
const cycleId = "cyc_01K0ABCDEFGHJKMNPQRSTVWXYZ";
const historicalCycleId = "cyc_01K0ABCDEFGHJKMNPQRSTVWXY0";
const questions = [
  {
    id: "qst_01K0ABCDEFGHJKMNPQRSTVWXYZ",
    taskId,
    cycleId,
    text: "¿Qué comportamiento esperabas?",
    type: "text",
    options: [],
    allowOther: false,
    answerText: null,
    selectedOptionIds: [],
    status: "open",
    createdAt: "2026-07-21T10:00:00.000Z",
    updatedAt: "2026-07-21T10:00:00.000Z",
    answeredAt: null,
    dismissedAt: null,
  },
  {
    id: "qst_01K0ABCDEFGHJKMNPQRSTVWXY0",
    taskId,
    cycleId,
    text: "¿En qué entorno ocurre?",
    type: "single_choice",
    options: [
      { id: "opt_01K0ABCDEFGHJKMNPQRSTVWXYZ", label: "Producción", position: 0 },
      { id: "opt_01K0ABCDEFGHJKMNPQRSTVWXY0", label: "Pruebas", position: 1 },
    ],
    allowOther: true,
    answerText: null,
    selectedOptionIds: [],
    status: "open",
    createdAt: "2026-07-21T10:01:00.000Z",
    updatedAt: "2026-07-21T10:01:00.000Z",
    answeredAt: null,
    dismissedAt: null,
  },
  {
    id: "qst_01K0ABCDEFGHJKMNPQRSTVWXY1",
    taskId,
    cycleId,
    text: "¿Qué áreas están afectadas?",
    type: "multiple_choice",
    options: [
      { id: "opt_01K0ABCDEFGHJKMNPQRSTVWXY1", label: "API", position: 0 },
      { id: "opt_01K0ABCDEFGHJKMNPQRSTVWXY2", label: "Web", position: 1 },
    ],
    allowOther: false,
    answerText: null,
    selectedOptionIds: [],
    status: "open",
    createdAt: "2026-07-21T10:02:00.000Z",
    updatedAt: "2026-07-21T10:02:00.000Z",
    answeredAt: null,
    dismissedAt: null,
  },
];

const activeTask = {
  id: taskId,
  version: 4,
  title: "Revisar exportación de asistentes",
  userRequest: "Al exportar asistentes desaparece el teléfono.",
  curatorSpec: "# Summary\nConservar el teléfono en el CSV.",
  status: "blocked",
  prUrl: null,
  automationPaused: false,
  currentCycleId: cycleId,
  currentDeliveryId: null,
  readyApprovalPending: false,
  currentCycle: {
    id: cycleId,
    taskId,
    number: 1,
    deliveryId: null,
    createdAt: "2026-07-21T10:00:00.000Z",
    completedAt: null,
  },
  currentDelivery: null,
  project,
  questions,
  specRevisions: [
    {
      id: "spc_01K0ABCDEFGHJKMNPQRSTVWXY0",
      taskId,
      cycleId,
      revision: 1,
      content: "# Summary\nExportar nombre y correo.",
      createdAt: "2026-07-21T10:01:00.000Z",
    },
    {
      id: "spc_01K0ABCDEFGHJKMNPQRSTVWXYZ",
      taskId,
      cycleId,
      revision: 2,
      content: "# Summary\nConservar el teléfono en el CSV.",
      createdAt: "2026-07-21T10:02:00.000Z",
    },
  ],
  attachments: [
    {
      id: "att_01K0ABCDEFGHJKMNPQRSTVWXYZ",
      taskId,
      cycleId,
      messageId: null,
      originalName: "export.log",
      mimeType: "text/plain",
      sizeBytes: 512,
      sha256: "a".repeat(64),
      downloadUrl: `/api/v1/tasks/${taskId}/attachments/att_01K0ABCDEFGHJKMNPQRSTVWXYZ/content`,
      createdAt: "2026-07-21T10:03:00.000Z",
    },
  ],
  createdAt: "2026-07-21T10:00:00.000Z",
  updatedAt: "2026-07-21T12:00:00.000Z",
  archivedAt: null,
};

const taskSummary = {
  id: taskId,
  projectId: project.id,
  projectName: project.name,
  title: activeTask.title,
  status: activeTask.status,
  version: activeTask.version,
  prUrl: null,
  createdAt: activeTask.createdAt,
  updatedAt: activeTask.updatedAt,
  archivedAt: null,
};

const secondTaskSummary = {
  ...taskSummary,
  id: "tsk_01K0ABCDEFGHJKMNPQRSTVWXY0",
  title: "Segunda Task cargada",
  version: 2,
};

const runWithLogs = {
  id: "run_01K0ABCDEFGHJKMNPQRSTVWXYZ",
  taskId,
  cycleId,
  deliveryId: null,
  projectId: project.id,
  agentProfileId: "agp_01K0ABCDEFGHJKMNPQRSTVWXYZ",
  kind: "implementation",
  outcome: null,
  attempt: 2,
  status: "succeeded",
  taskVersion: 4,
  executionStage: "publishing",
  resumeFromRunId: null,
  branchName: "aiws/test/run",
  baseSha: null,
  headSha: null,
  prUrl: null,
  summary: "Run completed.",
  errorCode: null,
  errorMessage: null,
  logsStorageKey: "runs/run_01K0ABCDEFGHJKMNPQRSTVWXYZ.jsonl",
  heartbeatAt: null,
  startedAt: null,
  finishedAt: null,
  createdAt: "2026-07-21T10:04:00.000Z",
  updatedAt: "2026-07-21T10:05:00.000Z",
  readyPolicy: null,
  verificationContractRevision: null,
};

const runWithoutLogs = {
  ...runWithLogs,
  id: "run_01K0ABCDEFGHJKMNPQRSTVWXY0",
  kind: "curation",
  readyPolicy: "curator_decides",
  verificationContractRevision: null,
  attempt: 1,
  status: "failed",
  branchName: null,
  summary: null,
  errorCode: "runner_failed",
  errorMessage: "Runner failed before Codex produced an event stream.",
  logsStorageKey: null,
};

async function mockApi(
  page: Page,
  options: {
    archived?: boolean;
    conflict?: boolean;
    draft?: boolean;
    questionAnswerFeedback?: boolean;
    runs?: boolean;
    runControls?: "active" | "retry";
    paused?: boolean;
    notificationTestFailure?: boolean;
    projectProfiles?: boolean;
    curating?: boolean;
    lastQuestion?: boolean;
    healthOffline?: boolean;
    taskUnauthorized?: boolean;
    paginatedTasks?: boolean;
    projectTasksMore?: boolean;
    extremeStrings?: boolean;
    uploadPartial?: boolean;
    projectReadiness?: boolean;
    readyApprovalPending?: boolean;
    specSave?: boolean;
    managedConnection?: boolean;
    taskStatus?: "draft" | "curating" | "blocked" | "ready" | "implementing" | "done";
    cycles?: boolean;
  } = {},
) {
  let questionAnswered = false;
  let attachmentUploadAttempt = 0;
  let verificationRevision = 0;
  let verificationCommands: unknown[] = [];
  let notificationSettings = {
    enabled: false,
    baseUrl: "https://ntfy.sh",
    topic: "",
    accessTokenConfigured: false,
    updatedAt: "2026-07-24T10:00:00.000Z",
  };
  await page.route("**/api/v1/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname.replace("/api/v1", "");
    const baseTask = {
      ...(options.draft
        ? { ...activeTask, status: "draft", version: 1, curatorSpec: "", questions: [] }
        : options.curating
          ? { ...activeTask, status: "curating", questions: [] }
          : options.lastQuestion
            ? { ...activeTask, status: "blocked", questions: [questions[0]] }
            : options.paused
              ? { ...activeTask, status: "curating", questions: [] }
              : activeTask),
      ...(options.taskStatus
        ? {
            status: options.taskStatus,
            questions: options.taskStatus === "blocked" ? activeTask.questions : [],
          }
        : {}),
      ...(options.cycles ? { currentCycle: { ...activeTask.currentCycle, number: 2 } } : {}),
      automationPaused: options.paused ?? false,
      readyApprovalPending: options.readyApprovalPending ?? false,
    };
    const statusTask = options.runControls
      ? {
          ...baseTask,
          status: options.runControls === "active" ? "implementing" : "ready",
          questions: [],
        }
      : baseTask;
    const representedTask = options.extremeStrings
      ? {
          ...statusTask,
          title: `Task ${"con-un-título-extremo-".repeat(20)}`,
          userRequest: `${"Línea extensa de petición con contexto operativo. ".repeat(80)}\n${"x".repeat(500)}`,
          curatorSpec: `# Spec\n\n${"Detalle multilínea de implementación. ".repeat(120)}`,
          prUrl: `https://github.com/example/${"repositorio-muy-largo-".repeat(12)}/pull/123456`,
          attachments: statusTask.attachments.map((attachment) => ({
            ...attachment,
            originalName: `${"captura-de-diagnostico-muy-larga-".repeat(8)}.log`,
          })),
        }
      : statusTask;
    const representedRuns =
      options.runControls === "active"
        ? [{ ...runWithLogs, status: "running", executionStage: "agent", summary: null }]
        : options.runControls === "retry"
          ? [{ ...runWithLogs, status: "failed", errorMessage: "Push failed." }]
          : [
              options.extremeStrings
                ? {
                    ...runWithLogs,
                    branchName: `feature/${"rama-extremadamente-larga-".repeat(16)}`,
                    summary: "Resumen extenso. ".repeat(80),
                  }
                : runWithLogs,
              runWithoutLogs,
            ];
    if (path === "/health") {
      return options.healthOffline
        ? route.fulfill({ status: 503, json: { status: "unhealthy", version: "0.8.0" } })
        : route.fulfill({ json: { status: "ok", version: "0.8.0" } });
    }
    if (path === "/system/runner") {
      return route.fulfill({
        json: {
          status: "online",
          lastSeenAt: "2026-07-24T06:00:00.000Z",
          offlineAfterSeconds: 45,
        },
      });
    }
    if (path === "/auth/session")
      return route.fulfill({ json: { authenticated: true, username: "admin" } });
    if (path === "/notification-settings" && route.request().method() === "GET") {
      return route.fulfill({ json: notificationSettings });
    }
    if (path === "/notification-settings" && route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON() as {
        enabled?: boolean;
        baseUrl?: string;
        topic?: string;
        accessToken?: string | null;
      };
      notificationSettings = {
        ...notificationSettings,
        ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
        ...(patch.baseUrl === undefined ? {} : { baseUrl: patch.baseUrl }),
        ...(patch.topic === undefined ? {} : { topic: patch.topic }),
        accessTokenConfigured:
          patch.accessToken === undefined
            ? notificationSettings.accessTokenConfigured
            : patch.accessToken !== null,
        updatedAt: "2026-07-24T10:01:00.000Z",
      };
      return route.fulfill({ json: notificationSettings });
    }
    if (path === "/notification-settings/test") {
      return options.notificationTestFailure
        ? route.fulfill({
            status: 503,
            json: {
              error: {
                code: "notification_unavailable",
                message: "The test notification could not be delivered.",
                requestId: "req_ntfy_failed",
              },
            },
          })
        : route.fulfill({ status: 204 });
    }
    if (path === "/connections") {
      return route.fulfill({ json: options.managedConnection ? [managedConnection] : [] });
    }
    if (path === `/connections/${connectionId}/repositories` && options.managedConnection) {
      return route.fulfill({ json: [remoteRepository] });
    }
    if (path === "/agent-profiles")
      return route.fulfill({
        json: options.projectProfiles
          ? [
              {
                id: "agp_01K0ABCDEFGHJKMNPQRSTVWXYZ",
                name: "Curator",
                runtime: "codex",
                authMode: "api_key",
                credentialReference: "CURATOR_KEY",
                model: "gpt-default",
                reasoningEffort: "medium",
                enabled: true,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
              },
            ]
          : [],
      });
    if (path === "/agent-profiles/model-catalog") {
      return route.fulfill({
        json: {
          models: [
            {
              id: "gpt-default",
              name: "GPT Default",
              description: "Default fixture model",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["low", "medium"],
            },
            {
              id: "gpt-high",
              name: "GPT High",
              description: "High fixture model",
              isDefault: false,
              defaultReasoningEffort: "high",
              supportedReasoningEfforts: ["high"],
            },
          ],
        },
      });
    }
    if (path === "/projects")
      return route.fulfill({
        json: {
          items: [
            options.extremeStrings
              ? {
                  ...project,
                  name: `Project ${"muy-largo-".repeat(20)}`,
                  repositoryPath: `/srv/repos/${"segmento-muy-largo/".repeat(20)}`,
                }
              : project,
          ],
          nextCursor: null,
        },
      });
    if (path === `/projects/${project.id}` && route.request().method() === "GET")
      return route.fulfill({
        json: options.projectReadiness
          ? {
              ...project,
              repositoryMode: "managed",
              connectionId: "con_01K0ABCDEFGHJKMNPQRSTVWXYZ",
              remoteRepositoryId: "repo-1",
              remoteFullName: "almaro90/aiws",
              remoteWebUrl: "https://github.com/almaro90/aiws",
              defaultBranch: "main",
            }
          : project,
      });
    if (path === `/projects/${project.id}/branches` && options.projectReadiness) {
      return route.fulfill({ json: [{ name: "main", protected: true }] });
    }
    if (path === `/projects/${project.id}/verification-contract`) {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        verificationRevision += 1;
        verificationCommands = body.commands;
      }
      return route.fulfill({
        json: {
          projectId: project.id,
          latestRevision: verificationRevision || null,
          active: verificationRevision
            ? {
                projectId: project.id,
                revision: verificationRevision,
                enabled: true,
                commands: verificationCommands,
                createdAt: "2026-07-26T10:00:00.000Z",
              }
            : null,
        },
      });
    }
    if (path === `/projects/${project.id}/verification-contract/revisions`) {
      return route.fulfill({
        json: verificationRevision
          ? [
              {
                projectId: project.id,
                revision: verificationRevision,
                enabled: true,
                commands: verificationCommands,
                createdAt: "2026-07-26T10:00:00.000Z",
              },
            ]
          : [],
      });
    }
    if (
      path === `/projects/${project.id}/verification-contract/disable` &&
      route.request().method() === "POST"
    ) {
      verificationRevision += 1;
      verificationCommands = [];
      return route.fulfill({
        json: { projectId: project.id, latestRevision: verificationRevision, active: null },
      });
    }
    if (path === `/projects/${project.id}/readiness-check` && route.request().method() === "POST") {
      const depth = route.request().postDataJSON().depth as "standard" | "deep";
      return route.fulfill({
        json: {
          projectId: project.id,
          depth,
          checkedAt: "2026-07-26T10:00:00.000Z",
          durationMs: depth === "deep" ? 240 : 12,
          ok: true,
          checks: [
            {
              id: "repository",
              status: "pass",
              message: "Remote repository is accessible.",
              details: {},
            },
          ],
        },
      });
    }
    if (path === `/projects/${project.id}` && route.request().method() === "PATCH") {
      return route.fulfill({ json: { ...project, ...route.request().postDataJSON() } });
    }
    if (path === "/tasks") {
      if (options.paginatedTasks && requestUrl.searchParams.has("cursor")) {
        return route.fulfill({
          json: { items: [taskSummary, secondTaskSummary], nextCursor: null },
        });
      }
      return route.fulfill({
        json: {
          items: [
            {
              ...taskSummary,
              ...(options.extremeStrings
                ? { title: `Task ${"con-un-título-extremo-".repeat(20)}` }
                : {}),
              status: options.curating ? "curating" : representedTask.status,
            },
          ],
          nextCursor:
            options.paginatedTasks ||
            (options.projectTasksMore && requestUrl.searchParams.get("projectId") === project.id)
              ? "cursor_next"
              : null,
        },
      });
    }
    if (path === `/tasks/${taskId}/runs`) {
      return route.fulfill({ json: options.runs ? representedRuns : [] });
    }
    if (path === `/tasks/${taskId}/timeline`) {
      const timelineQuestions = representedTask.questions.map((question, index) =>
        options.questionAnswerFeedback && questionAnswered && index === 0
          ? {
              ...question,
              answerText: "El CSV pierde el teléfono.",
              status: "answered",
              answeredAt: "2026-07-21T12:01:00.000Z",
            }
          : question,
      );
      const questionItems = timelineQuestions.map((question, index) => ({
        kind: "question",
        cycleId,
        createdAt: question.createdAt,
        question,
        answers:
          options.questionAnswerFeedback && questionAnswered && index === 0
            ? [
                {
                  id: "ans_01K0ABCDEFGHJKMNPQRSTVWXYZ",
                  questionId: question.id,
                  cycleId,
                  revision: 1,
                  answerText: "El CSV pierde el teléfono.",
                  selectedOptionIds: [],
                  createdAt: "2026-07-21T12:01:00.000Z",
                },
              ]
            : [],
      }));
      const runItems = options.runs
        ? representedRuns.map((run) => ({
            kind: "run",
            cycleId,
            createdAt: run.createdAt,
            run,
          }))
        : [];
      const activityItems = [
        {
          kind: "event",
          cycleId,
          createdAt: "2026-07-21T10:03:30.000Z",
          event: {
            id: "evt_01K0ABCDEFGHJKMNPQRSTVWXYZ",
            taskId,
            type: "status_changed",
            actorType: "system",
            metadata: {
              taskVersion: representedTask.version,
              from: "curating",
              to: representedTask.status,
              automatic: true,
              secret: "never render",
            },
            createdAt: "2026-07-21T10:03:30.000Z",
          },
        },
      ];
      const historicalItems = options.cycles
        ? [
            {
              kind: "message",
              id: "msg_01K0ABCDEFGHJKMNPQRSTVWXY0",
              taskId,
              cycleId: historicalCycleId,
              type: "initial_request",
              text: "Petición del primer Cycle.",
              createdAt: "2026-07-20T10:00:00.000Z",
            },
            {
              kind: "event",
              cycleId,
              createdAt: "2026-07-21T09:59:00.000Z",
              event: {
                id: "evt_01K0ABCDEFGHJKMNPQRSTVWXY0",
                taskId,
                type: "cycle_created",
                actorType: "web",
                metadata: { taskVersion: 4, cycleId, number: 2 },
                createdAt: "2026-07-21T09:59:00.000Z",
              },
            },
          ]
        : [];
      return route.fulfill({
        json: {
          items: [...historicalItems, ...questionItems, ...activityItems, ...runItems],
          nextCursor: null,
        },
      });
    }
    if (path === `/runs/${runWithLogs.id}/logs` && options.runs) {
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: '{"type":"turn.completed","usage":{"input_tokens":10}}\n',
      });
    }
    if (path === `/runs/${runWithoutLogs.id}/logs` && options.runs) {
      return route.fulfill({
        status: 404,
        json: {
          error: {
            code: "not_found",
            message: "Run logs were not found.",
            requestId: "req_no_logs",
          },
        },
      });
    }
    if (path === `/runs/${runWithLogs.id}` && options.runs) {
      return route.fulfill({ json: representedRuns[0] });
    }
    if (path === `/runs/${runWithLogs.id}/cancel` && options.runControls === "active") {
      return route.fulfill({ json: { ...representedRuns[0], status: "cancelled" } });
    }
    if (path === `/runs/${runWithLogs.id}/retry` && options.runControls === "retry") {
      return route.fulfill({ status: 201, json: { run: representedRuns[0] } });
    }
    if (path.endsWith("/activity")) return route.fulfill({ json: { items: [], nextCursor: null } });
    if (
      path === `/tasks/${taskId}/questions/${questions[0]?.id}/answer` &&
      options.questionAnswerFeedback
    ) {
      questionAnswered = true;
      return route.fulfill({
        json: {
          ...activeTask,
          version: 5,
          questions: activeTask.questions.map((question, index) =>
            index === 0
              ? {
                  ...question,
                  answerText: "El CSV pierde el teléfono.",
                  status: "answered",
                  answeredAt: "2026-07-21T12:01:00.000Z",
                }
              : question,
          ),
        },
      });
    }
    if (path === `/tasks/${taskId}/questions/${questions[0]?.id}/dismiss` && options.lastQuestion) {
      return route.fulfill({
        json: {
          ...representedTask,
          version: representedTask.version + 1,
          status: "curating",
          questions: [{ ...questions[0], status: "dismissed" }],
        },
      });
    }
    if (path === `/tasks/${taskId}` && route.request().method() === "PATCH" && options.conflict) {
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: "version_conflict",
            message: "Task version does not match.",
            details: { expectedVersion: 4, currentVersion: 5 },
            requestId: "req_conflict",
          },
        },
      });
    }
    if (path === `/tasks/${taskId}` && route.request().method() === "PATCH" && options.draft) {
      const request = route.request().postDataJSON() as { userRequest?: string };
      return route.fulfill({ json: { ...representedTask, ...request, version: 2 } });
    }
    if (path === `/tasks/${taskId}` && route.request().method() === "PATCH" && options.specSave) {
      const request = route.request().postDataJSON() as { curatorSpec?: string };
      return route.fulfill({
        json: {
          ...representedTask,
          ...request,
          version: representedTask.version + 1,
        },
      });
    }
    if (path === `/tasks/${taskId}/transition` && options.draft) {
      return route.fulfill({ json: { ...representedTask, status: "curating", version: 3 } });
    }
    if (path === `/tasks/${taskId}/transition` && options.readyApprovalPending) {
      return route.fulfill({
        json: {
          ...representedTask,
          status: "ready",
          readyApprovalPending: false,
          version: representedTask.version + 1,
        },
      });
    }
    if (path === `/tasks/${taskId}/automation/resume`) {
      return route.fulfill({
        json: { ...representedTask, automationPaused: false, version: representedTask.version + 1 },
      });
    }
    if (
      path === `/tasks/${taskId}/attachments` &&
      route.request().method() === "POST" &&
      options.uploadPartial
    ) {
      attachmentUploadAttempt += 1;
      if (attachmentUploadAttempt === 2) {
        return route.fulfill({
          status: 415,
          json: {
            error: {
              code: "unsupported_media_type",
              message: "El fichero no coincide con su tipo.",
              requestId: "req_upload_failed",
            },
          },
        });
      }
      return route.fulfill({
        status: 201,
        json: {
          attachment: {
            ...activeTask.attachments[0],
            id: `att_01K0ABCDEFGHJKMNPQRSTVWXY${attachmentUploadAttempt}`,
          },
          taskVersion: representedTask.version + attachmentUploadAttempt,
        },
      });
    }
    if (path === `/tasks/${taskId}`) {
      if (options.taskUnauthorized) {
        return route.fulfill({
          status: 401,
          json: {
            error: {
              code: "unauthorized",
              message: "Authentication is required.",
              requestId: "req_expired",
            },
          },
        });
      }
      return route.fulfill({
        json: options.archived
          ? { ...activeTask, questions: [], archivedAt: "2026-07-21T13:00:00.000Z" }
          : representedTask,
      });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Not found", requestId: "req_404" } },
    });
  });
}

async function navigateFromSidebar(page: Page, label: string) {
  const primaryNavigation = page.getByRole("navigation", { name: "Principal" });
  let link = primaryNavigation.getByRole("link", { name: label, exact: true });
  if (!(await link.first().isVisible())) {
    await page.getByRole("button", { name: "Abrir navegación" }).click();
    link = primaryNavigation.getByRole("link", { name: label, exact: true });
  }
  await link.click();
}

async function openInspectorIfNeeded(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    const trigger = page.getByRole("button", { name: "Abrir inspector" });
    await expect(trigger).toBeVisible();
    await trigger.click();
  }
}

async function openAttachments(page: Page) {
  await openInspectorIfNeeded(page);
  await page.getByText(/^Attachments \(\d+\)$/).click();
}

test("selects model and reasoning effort only from the live catalog", async ({ page }) => {
  await mockApi(page);
  await page.goto("/automation");
  const selects = page.getByRole("combobox");
  await expect(selects.nth(1)).toContainText("GPT Default");
  await expect(selects.nth(2)).toContainText("medium");
  await page.getByLabel("Nombre").fill("Codex profile");
  await expect(page.getByRole("button", { name: "Crear perfil" })).toBeEnabled();

  await selects.nth(1).click();
  await page.getByRole("option", { name: "GPT High" }).click();
  await expect(selects.nth(2)).toContainText("high");
});

test("shows the selected Project name before opening the Select", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/new?projectId=${project.id}`);
  const projectSelect = page.getByRole("combobox", { name: "Project" });
  await expect(projectSelect).toContainText(project.name);
  await expect(projectSelect).not.toContainText(project.id);
});

test("configures Curation independently and requires a profile to activate Implementation", async ({
  page,
}) => {
  await mockApi(page, { projectProfiles: true });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByText("Perfil de Curation")).toBeVisible();
  await expect(page.getByText("Perfil de Implementation")).toBeVisible();
  const implementation = page.getByRole("switch", { name: "Implementation desactivada" });
  await expect(implementation).not.toBeChecked();

  const selects = page.getByRole("combobox");
  await selects.nth(2).click();
  await page.getByRole("option", { name: "Curator" }).click();
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(page.getByText("Automatización guardada")).toBeVisible();

  await implementation.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Guardar configuración" })).toBeDisabled();
  await expect(page.getByText("No se puede guardar la configuración")).toBeVisible();
  await expect(
    page.getByText("Selecciona un Perfil de Implementation para activar Implementation."),
  ).toBeVisible();
});

test("identifies each dirty Project section and navigates between commit boundaries", async ({
  page,
}) => {
  await mockApi(page, { projectProfiles: true });
  await page.goto(`/projects/${project.id}`);
  const sections = page.getByRole("navigation", { name: "Secciones del Project" });
  await expect(sections.getByRole("link")).toHaveCount(5);

  await page.getByLabel("Nombre").fill("AIWS editado");
  await expect(sections.getByRole("link", { name: "Repositorio Modificado" })).toBeVisible();

  const curationProfile = page.getByRole("combobox", { name: "Perfil de Curation" });
  await curationProfile.click();
  await page.getByRole("option", { name: "Curator" }).click();
  await expect(sections.getByRole("link", { name: "Configuración Modificado" })).toBeVisible();

  await page
    .getByLabel("Comandos JSON")
    .fill(
      JSON.stringify(
        [{ name: "tests", executable: "bun", args: ["test"], required: true, timeoutSeconds: 300 }],
        null,
        2,
      ),
    );
  await expect(sections.getByRole("link", { name: "Verificación Modificado" })).toBeVisible();

  await sections.getByRole("link", { name: "Configuración Modificado" }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe(`#project-configuration-${project.id}`);
});

test("runs standard and explicitly confirmed deep Project Readiness checks", async ({ page }) => {
  await mockApi(page, { projectReadiness: true });
  await page.goto(`/projects/${project.id}`);

  const standardRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/v1/projects/${project.id}/readiness-check`) &&
      request.method() === "POST",
  );
  await page.getByRole("button", { name: "Comprobar", exact: true }).click();
  expect((await standardRequest).postDataJSON()).toEqual({ depth: "standard" });
  await expect(page.getByText("Preparado", { exact: true })).toBeVisible();
  await expect(page.getByText("Remote repository is accessible.")).toBeVisible();

  await page.getByRole("button", { name: "Probe profundo" }).click();
  await expect(page.getByRole("alertdialog", { name: "Ejecutar probe profundo" })).toBeVisible();
  const deepRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/v1/projects/${project.id}/readiness-check`) &&
      request.method() === "POST" &&
      request.postDataJSON().depth === "deep",
  );
  await page.getByRole("button", { name: "Ejecutar probe" }).click();
  expect((await deepRequest).postDataJSON()).toEqual({ depth: "deep" });
  await expect(page.getByText(/Profundo · 240 ms/)).toBeVisible();
});

test("configures and consumes manual Ready approval without a new Task status", async ({
  page,
}) => {
  await mockApi(page, { projectProfiles: true, projectReadiness: true });
  await page.goto(`/projects/${project.id}`);
  const policy = page.getByRole("combobox", { name: "Decisión de Ready" });
  await policy.click();
  await page.getByRole("option", { name: "Requiere aprobación manual" }).click();
  const projectRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/v1/projects/${project.id}`) && request.method() === "PATCH",
  );
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  expect((await projectRequest).postDataJSON()).toMatchObject({
    readyPolicy: "manual_approval_required",
  });

  await page.unrouteAll({ behavior: "wait" });
  await mockApi(page, { taskStatus: "curating", readyApprovalPending: true });
  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByText("Aprobación Ready pendiente")).toBeVisible();
  await page.getByRole("button", { name: "Aprobar y marcar Ready" }).click();
  const dialog = page.getByRole("dialog", { name: "Aprobar y marcar Ready" });
  const approvalRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/v1/tasks/${taskId}/transition`) && request.method() === "POST",
  );
  await dialog.getByRole("button", { name: "Aprobar y marcar Ready" }).click();
  expect((await approvalRequest).postDataJSON()).toMatchObject({
    from: "curating",
    to: "ready",
  });
  await expect(page.getByText("Aprobación Ready pendiente")).toHaveCount(0);
});

test("reviews the latest immutable Spec change before Ready", async ({ page }) => {
  await mockApi(page, { taskStatus: "curating" });
  await page.goto(`/tasks/${taskId}`);
  await openInspectorIfNeeded(page);
  const summary = page.getByText("Cambios de revisión 1 a 2");
  await expect(summary).toBeVisible();
  await summary.click();
  await expect(page.getByText("- Exportar nombre y correo.")).toBeVisible();
  await expect(page.getByText("+ Conservar el teléfono en el CSV.")).toBeVisible();
});

test("blocks Ready until the visible Curator Spec draft is saved", async ({ page }) => {
  await mockApi(page, {
    taskStatus: "curating",
    readyApprovalPending: true,
    specSave: true,
  });
  await page.goto(`/tasks/${taskId}`);
  await openInspectorIfNeeded(page);
  const editor = page.getByLabel("Curator Spec Markdown");
  const draft = "# Summary\nConservar teléfono y prefijo internacional.";
  await editor.fill(draft);
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.getByRole("button", { name: "Cerrar inspector" }).click();
  }

  const ready = page.getByRole("button", { name: "Aprobar y marcar Ready" });
  await expect(ready).toBeDisabled();
  await expect(page.getByText("Ready bloqueado por cambios sin guardar")).toBeVisible();

  await page.getByRole("button", { name: "Revisar borrador" }).click();
  await expect(editor).toBeFocused();
  const saveRequest = page.waitForRequest(
    (request) => request.url().endsWith(`/api/v1/tasks/${taskId}`) && request.method() === "PATCH",
  );
  await page.getByRole("button", { name: "Guardar Spec" }).click();
  const saved = await saveRequest;
  expect(saved.postDataJSON()).toEqual({ curatorSpec: draft });
  expect(saved.headers()["if-match"]).toBe('"4"');

  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.getByRole("button", { name: "Cerrar inspector" }).click();
  }
  await expect(ready).toBeEnabled();
  await ready.click();
  const dialog = page.getByRole("dialog", { name: "Aprobar y marcar Ready" });
  const transitionRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/v1/tasks/${taskId}/transition`) && request.method() === "POST",
  );
  await dialog.getByRole("button", { name: "Aprobar y marcar Ready" }).click();
  expect((await transitionRequest).headers()["if-match"]).toBe('"5"');
});

test("creates and disables an immutable Project Verification Contract revision", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByText("No configurado", { exact: true })).toBeVisible();
  const commands = [
    {
      name: "tests",
      executable: "bun",
      args: ["test"],
      required: true,
      timeoutSeconds: 300,
    },
  ];
  await page.getByLabel("Comandos JSON").fill(JSON.stringify(commands, null, 2));
  const replaceRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/v1/projects/${project.id}/verification-contract`) &&
      request.method() === "PUT",
  );
  await page.getByRole("button", { name: "Guardar nueva revisión" }).click();
  expect((await replaceRequest).postDataJSON()).toEqual({
    expectedRevision: null,
    commands,
  });
  await expect(page.getByText("Activo · revision 1")).toBeVisible();
  await expect(page.getByText("Revision 1 · 1 comandos")).toBeHidden();
  await page.getByText("Historial de revisiones (1)").click();
  await expect(page.getByText("Revision 1 · 1 comandos")).toBeVisible();

  await page.getByRole("button", { name: "Desactivar contrato" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Desactivar Verification Contract" });
  const disableRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/v1/projects/${project.id}/verification-contract/disable`) &&
      request.method() === "POST",
  );
  await dialog.getByRole("button", { name: "Desactivar" }).click();
  expect((await disableRequest).postDataJSON()).toEqual({ expectedRevision: 1 });
  await expect(page.getByText("No configurado", { exact: true })).toBeVisible();
});

test("configures masked ntfy notifications and keeps the mobile layout accessible", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Notificaciones", exact: true })).toBeVisible();
  await expect(page.getByText("Un topic sin autenticación puede ser público.")).toBeVisible();
  const notificationSwitch = page.getByRole("switch", {
    name: "Notificaciones desactivadas",
  });
  await notificationSwitch.focus();
  await page.keyboard.press("Space");
  await expect(page.getByText("Cambios sin guardar")).toBeVisible();
  await page.getByLabel("Topic").fill("private_topic");
  await page.getByLabel("Token Bearer opcional").fill("secret-token");
  const saveRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/v1/notification-settings") && request.method() === "PATCH",
  );
  await page.getByRole("button", { name: "Guardar" }).click();
  expect((await saveRequest).postDataJSON()).toMatchObject({
    enabled: true,
    topic: "private_topic",
    accessToken: "secret-token",
  });
  await expect(page.getByText("•••••••••••• configurado")).toBeVisible();
  await page.getByRole("button", { name: "Enviar prueba con configuración guardada" }).click();
  await expect(page.getByText("Notificación de prueba entregada")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("shows the notification test request ID without exposing an upstream body", async ({
  page,
}) => {
  await mockApi(page, { notificationTestFailure: true });
  await page.goto("/notifications");
  await page.getByRole("button", { name: "Enviar prueba con configuración guardada" }).click();
  await expect(page.getByText("req_ntfy_failed")).toBeVisible();
  await expect(page.getByText("secret upstream body")).toHaveCount(0);
});

test("guards unsaved Project, Automation and Notification drafts", async ({ page }) => {
  await mockApi(page, { projectProfiles: true });

  await page.goto(`/projects/${project.id}`);
  await page.getByLabel("Nombre").fill("AIWS editado");
  await expect(page.getByText("Cambios sin guardar")).toBeVisible();
  await navigateFromSidebar(page, "Tasks");
  await expect(page.getByRole("alertdialog", { name: "Hay cambios sin guardar" })).toBeVisible();
  await page.getByRole("button", { name: "Salir sin guardar" }).click();

  await page.goto("/automation");
  await page.getByLabel("Nombre").fill("Perfil sin guardar");
  await navigateFromSidebar(page, "Tasks");
  await expect(page.getByRole("alertdialog", { name: "Hay cambios sin guardar" })).toBeVisible();
  await page.getByRole("button", { name: "Salir sin guardar" }).click();

  await page.goto("/notifications");
  await page.getByLabel("URL base").fill("no-es-url");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByLabel("URL base")).toBeFocused();
  await navigateFromSidebar(page, "Tasks");
  await expect(page.getByRole("alertdialog", { name: "Hay cambios sin guardar" })).toBeVisible();
});

test("keeps successful Attachments and retries only failed uploads", async ({ page }) => {
  await mockApi(page, { uploadPartial: true });
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().endsWith(`/api/v1/tasks/${taskId}/attachments`) &&
      request.method() === "POST"
    ) {
      uploads.push(request.url());
    }
  });
  await page.goto(`/tasks/${taskId}`);
  await openAttachments(page);
  await page.getByLabel("Añadir ficheros").setInputFiles([
    { name: "correcto.txt", mimeType: "text/plain", buffer: Buffer.from("correcto") },
    { name: "fallido.txt", mimeType: "text/plain", buffer: Buffer.from("fallido") },
  ]);
  await expect(page.getByLabel("Attachments preparados").getByText("Pendiente")).toHaveCount(2);
  await page.getByRole("button", { name: "Subir secuencialmente" }).click();
  await expect(page.getByText("Upload completado con errores")).toBeVisible();
  await expect(page.getByText("Subido", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Fallido", { exact: true })).toHaveCount(1);
  expect(uploads).toHaveLength(2);

  await page.getByRole("button", { name: "Reintentar fallidos" }).click();
  await expect(page.getByText("Upload completado", { exact: true })).toBeVisible();
  await expect(page.getByText("Subido", { exact: true })).toHaveCount(2);
  expect(uploads).toHaveLength(3);
});

test("hides the credential reference for a ChatGPT session", async ({ page }) => {
  await mockApi(page);
  await page.goto("/automation");
  const catalogRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/v1/agent-profiles/model-catalog") &&
      request.postDataJSON().authMode === "chatgpt_session",
  );
  await page.getByLabel("Modo de autenticación").click();
  await page.getByRole("option", { name: "Sesión ChatGPT" }).click();
  await expect(page.getByLabel("Referencia de credencial de entorno")).toHaveCount(0);
  await expect(page.getByText("Se usará la sesión ChatGPT configurada en Codex.")).toBeVisible();
  expect((await catalogRequest).postDataJSON()).toMatchObject({
    authMode: "chatgpt_session",
    credentialReference: "CODEX_SESSION",
  });
});

test("renders a responsive Task queue without horizontal overflow", async ({ page }) => {
  await mockApi(page);
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await expect(page.locator("a:visible", { hasText: activeTask.title }).first()).toBeVisible();
  await expect(page.locator("span:visible", { hasText: "Blocked" }).first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("shows the AIWS logo and blue brand tokens across login and the responsive shell", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.locator('[data-brand-logo="login"]')).toBeVisible();

  const brand = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      primary: styles.getPropertyValue("--primary").trim().toLowerCase(),
      foreground: styles.getPropertyValue("--primary-foreground").trim().toLowerCase(),
    };
  });
  expect(brand).toEqual({ primary: "#15a9fe", foreground: "#0f1c2e" });

  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const submit = page.getByRole("button", { name: "Entrar" });
  await expect(submit).toBeFocused();
  expect(await submit.evaluate((element) => getComputedStyle(element).boxShadow !== "none")).toBe(
    true,
  );

  await mockApi(page);
  await page.goto("/tasks");
  const desktop = (page.viewportSize()?.width ?? 0) >= 1024;
  if (desktop) {
    await expect(page.locator('[data-slot="sidebar"] [data-brand-logo="sidebar"]')).toBeVisible();
  } else {
    await expect(page.locator('[data-brand-logo="mobile-header"]')).toBeVisible();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("loads Oxanium locally as the global sans font without changing monospace content", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const sansFamilies = await page.evaluate(() => {
    const readFamily = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`Missing element: ${selector}`);
      return getComputedStyle(element).fontFamily;
    };

    return {
      body: readFamily("body"),
      button: readFamily("button"),
      input: readFamily("input"),
      loaded: document.fonts.check('16px "Oxanium Variable"'),
    };
  });

  expect(sansFamilies.loaded).toBe(true);
  for (const family of [sansFamilies.body, sansFamilies.button, sansFamilies.input]) {
    expect(family).toContain("Oxanium Variable");
  }

  await mockApi(page);
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  const { headingFamily, monoFamily } = await page.evaluate(() => {
    const heading = document.querySelector("h1");
    const mono = document.querySelector(".font-mono");
    if (!(heading instanceof HTMLElement)) throw new Error("Missing Task heading");
    if (!(mono instanceof HTMLElement)) throw new Error("Missing monospace content");
    return {
      headingFamily: getComputedStyle(heading).fontFamily,
      monoFamily: getComputedStyle(mono).fontFamily,
    };
  });
  expect(headingFamily).toContain("Oxanium Variable");
  expect(monoFamily).not.toContain("Oxanium Variable");
  expect(monoFamily).toContain("SFMono-Regular");
});

test("uses one responsive Sidebar with active navigation and focus restoration", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/tasks");
  const desktop = (page.viewportSize()?.width ?? 0) >= 1024;
  if (desktop) {
    const sidebar = page.locator('[data-slot="sidebar"]');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Tasks" })).toHaveClass(/bg-sidebar-accent/);
    await page.getByRole("button", { name: "Contraer o expandir navegación" }).click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  } else {
    const trigger = page.getByRole("button", { name: "Abrir navegación" });
    await trigger.click();
    const navigation = page.getByRole("navigation", { name: "Principal" });
    await expect(navigation).toBeVisible();
    await navigation.getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(navigation).toBeHidden();
    await expect(trigger).toBeFocused();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("shows navigable breadcrumbs on create and detail screens", async ({ page }) => {
  await mockApi(page);
  await page.goto("/tasks/new");
  let breadcrumb = page.getByRole("navigation", { name: "breadcrumb" });
  await expect(breadcrumb).toContainText("Tasks");
  await expect(breadcrumb).toContainText("Crear Task");
  await breadcrumb.getByRole("link", { name: "Tasks" }).click();
  await expect(page).toHaveURL(/\/tasks$/);

  await page.goto(`/tasks/${taskId}`);
  breadcrumb = page.getByRole("navigation", { name: "breadcrumb" });
  await expect(breadcrumb).toContainText(activeTask.title);

  await page.goto(`/projects/${project.id}`);
  breadcrumb = page.getByRole("navigation", { name: "breadcrumb" });
  await expect(breadcrumb).toContainText(project.name);
  await breadcrumb.getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("keeps Task filter controls synchronized with URL history and removable chips", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/tasks?status=ready");
  await expect(page.getByRole("checkbox", { name: "Ready" })).toBeChecked();
  await expect(page.getByRole("group", { name: "Filtros activos" })).toContainText("Estado: Ready");

  await page.getByText("Opciones avanzadas", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Mostrar archivadas" }).click();
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  expect(new URL(page.url()).searchParams.get("archived")).toBe("true");
  expect(JSON.parse(new URL(page.url()).searchParams.get("status") ?? "[]")).toEqual(["ready"]);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Ready" })).toBeChecked();
  await page.getByText("Opciones avanzadas", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Mostrar archivadas" })).toBeChecked();

  await page.goBack();
  await expect(page.getByRole("checkbox", { name: "Ready" })).toBeChecked();
  const archived = page.getByRole("checkbox", { name: "Mostrar archivadas" });
  if (!(await archived.isVisible())) {
    await page.getByText("Opciones avanzadas", { exact: true }).click();
  }
  await expect(archived).not.toBeChecked();
  await page.getByRole("button", { name: "Quitar filtro Estado: Ready" }).click();
  expect(new URL(page.url()).searchParams.has("status")).toBe(false);
});

test("keeps Project filters synchronized and individually removable", async ({ page }) => {
  await mockApi(page);
  await page.goto("/projects?gitProvider=github");
  const provider = page.getByRole("combobox", { name: "Proveedor Git" });
  await expect(provider).toContainText("GitHub");
  await expect(page.getByRole("group", { name: "Filtros activos" })).toContainText(
    "Proveedor: GitHub",
  );

  await provider.click();
  await page.getByRole("option", { name: "GitLab" }).click();
  await page.getByRole("button", { name: "Aplicar" }).click();
  expect(new URL(page.url()).searchParams.get("gitProvider")).toBe("gitlab");

  await page.goBack();
  await expect(provider).toContainText("GitHub");
  await page.getByRole("button", { name: "Quitar filtro Proveedor: GitHub" }).click();
  expect(new URL(page.url()).searchParams.has("gitProvider")).toBe(false);
});

test("loads cursor pages with a visible count and without duplicate rows", async ({ page }) => {
  await mockApi(page, { paginatedTasks: true });
  await page.goto("/tasks");
  await expect(page.getByText("1 resultado cargado")).toBeVisible();
  await page.getByRole("button", { name: "Cargar más" }).click();
  await expect(page.getByText("2 resultados cargados")).toBeVisible();
  await expect(
    page.getByRole("link", { name: secondTaskSummary.title, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: taskSummary.title, exact: true })).toHaveCount(1);
});

test("exposes additional Project Tasks through the complete filtered list", async ({ page }) => {
  await mockApi(page, { projectTasksMore: true });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByText("Mostrando las primeras 1 Tasks.")).toBeVisible();
  await page.getByRole("link", { name: "Ver todas las Tasks" }).click();
  expect(new URL(page.url()).pathname).toBe("/tasks");
  expect(new URL(page.url()).searchParams.get("projectId")).toBe(project.id);
});

test("keeps extreme list values contained and exposes copyable IDs", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockApi(page, { extremeStrings: true });
  await page.goto("/tasks");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const copy = page.getByRole("button", { name: "Copiar Task ID" }).first();
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(taskId);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("shows Curating consistently and explains when User Request becomes immutable", async ({
  page,
}) => {
  await mockApi(page, { curating: true });
  await page.goto("/tasks");
  await expect(page.locator("span:visible", { hasText: "Curating" }).first()).toBeVisible();

  await page.goto(`/tasks/${taskId}`);
  await expect(page.locator("span:visible", { hasText: "Curating" }).first()).toBeVisible();

  await page.goto("/tasks/new");
  await expect(
    page.getByText(
      "Podrás editar la User Request mientras la Task siga en Draft; se congelará al enviarla a Curation.",
    ),
  ).toBeVisible();
});

for (const scenario of [
  { status: "draft", action: "Enviar a curator" },
  { status: "curating", action: "Marcar Ready" },
  { status: "blocked", action: "Responder Questions" },
  { status: "ready", action: "Claim Task" },
  { status: "implementing", action: "Completar Task" },
  { status: "done", action: "Solicitar cambio" },
] as const) {
  test(`puts the ${scenario.status} operational action before history`, async ({ page }) => {
    await mockApi(page, { taskStatus: scenario.status });
    await page.goto(`/tasks/${taskId}`);

    const summary = page.getByLabel("Resumen operativo de la Task");
    await expect(summary).toBeVisible();
    await expect(summary.getByText("Cycle 1", { exact: true })).toBeVisible();
    await expect(summary.getByRole("button", { name: scenario.action })).toBeVisible();
    const timeline = page.getByRole("region", { name: "Timeline de la Task" });
    const summaryBox = await summary.boundingBox();
    const timelineBox = await timeline.boundingBox();
    expect(summaryBox?.y).toBeLessThan(timelineBox?.y ?? 0);
  });
}

test("numbers Cycles and translates Activity without exposing unknown metadata", async ({
  page,
}) => {
  await mockApi(page, { cycles: true });
  await page.goto(`/tasks/${taskId}`);

  await expect(page.getByRole("region", { name: "Cycle 1" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Cycle 2" })).toBeVisible();
  await expect(page.getByText("Estado cambiado", { exact: true })).toBeVisible();
  await expect(page.getByText("Sistema · curating → blocked", { exact: true })).toBeVisible();
  await expect(page.getByText("status_changed", { exact: true })).toHaveCount(0);
  await expect(page.getByText("never render", { exact: true })).toHaveCount(0);
});

test("prioritizes open Questions before context and focuses the first answer", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${taskId}`);

  const questionsHeading = page.getByRole("heading", { name: "Questions abiertas" });
  const contextHeading = page.getByText("Añadir contexto", { exact: true }).last();
  const questionsBox = await questionsHeading.boundingBox();
  const contextBox = await contextHeading.boundingBox();
  expect(questionsBox?.y).toBeLessThan(contextBox?.y ?? 0);

  await page.getByRole("button", { name: "Responder Questions" }).click();
  await expect(page.getByLabel("Respuesta")).toBeFocused();
  const timeline = page.getByRole("region", { name: "Timeline de la Task" });
  await expect(timeline.getByRole("button", { name: "Responder" })).toHaveCount(0);
});

test("explains that dismissing the last Question returns the Task to Curating", async ({
  page,
}) => {
  await mockApi(page, { lastQuestion: true });
  await page.goto(`/tasks/${taskId}`);
  await page.getByRole("button", { name: "Descartar" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText(
      "La Question quedará resuelta sin respuesta. Si es la última abierta, la Task volverá a Curating.",
    ),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Descartar" }).click();
  await expect(page.locator("span", { hasText: "Curating" }).first()).toBeVisible();
});

test("uses normalized terminology across Projects, Automation and Runs", async ({ page }) => {
  await mockApi(page, { runs: true, managedConnection: true });
  await page.goto("/projects");
  await expect(page.getByLabel("Proveedor Git")).toBeVisible();
  await expect(page.getByLabel("Ámbito de cuenta")).toBeVisible();

  await page.goto("/automation");
  await expect(page.getByRole("heading", { name: "Automatización", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Conectar GitHub" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Conectar Azure DevOps" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conexiones" })).toBeVisible();
  await page.getByRole("button", { name: "Elegir repos" }).click();
  const repository = page.getByRole("combobox", { name: "Repositorio gestionado" });
  await repository.click();
  await page.getByRole("option", { name: remoteRepository.fullName }).click();
  const accountScope = page.getByRole("combobox", { name: "Ámbito de cuenta" });
  await expect(accountScope).toBeVisible();
  await accountScope.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(accountScope).toContainText("Trabajo");
  await expect(page.getByRole("heading", { name: "Perfiles de agente" })).toBeVisible();
  await expect(page.getByLabel("Modelo")).toBeVisible();
  await expect(page.getByLabel("Esfuerzo de razonamiento")).toBeVisible();

  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByText("Run de Implementation · intento 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar", exact: true })).toHaveCount(0);
});

test("exposes one page heading and a navigable section outline", async ({ page }) => {
  await mockApi(page);

  await page.goto(`/projects/${project.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: project.name })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Repositorio" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Configuración" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Curation" })).toBeVisible();

  await page.goto("/projects/new");
  await expect(page.getByRole("heading", { level: 1, name: "Crear Project" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  await page.goto("/tasks/new");
  await expect(page.getByRole("heading", { level: 1, name: "Crear Task" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: activeTask.title })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Conversación e historial" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: /Question · ¿Qué comportamiento esperabas/ }),
  ).toBeVisible();

  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Iniciar sesión" })).toBeVisible();

  await page.goto("/ruta-inexistente");
  await expect(page.getByRole("heading", { level: 1, name: "Página no encontrada" })).toBeVisible();
});

test("keeps the current screen and controls available when health is offline", async ({ page }) => {
  await mockApi(page, { healthOffline: true });
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await expect(page.locator("a:visible", { hasText: activeTask.title }).first()).toBeVisible();
  await expect(
    page.getByText(
      "No se puede contactar con la API. El contenido mostrado se conserva; los cambios pueden fallar hasta recuperar la conexión.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar conexión" })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Crear Task" })).toBeVisible();
});

test("replaces an expired screen with login and preserves the complete return URL", async ({
  page,
}) => {
  await mockApi(page, { taskUnauthorized: true });
  await page.goto(`/tasks/${taskId}?panel=spec#run-2`);
  await expect(page.getByText("Iniciar sesión", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("redirect")).toBe(
    `/tasks/${taskId}?panel=spec#run-2`,
  );
});

test("renders all Question controls with keyboard semantics", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByLabel("Respuesta")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Producción" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "API" })).toBeVisible();
  await page.getByRole("radio", { name: "Producción" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("radio", { name: "Producción" })).toBeChecked();
});

test("replaces an answered Question with its persisted read-only state", async ({ page }) => {
  await mockApi(page, { questionAnswerFeedback: true });
  await page.goto(`/tasks/${taskId}`);

  await page.getByLabel("Respuesta").fill("El CSV pierde el teléfono.");
  await page.getByRole("button", { name: "Responder", exact: true }).first().click();

  await expect(page.getByText("Question respondida", { exact: true })).toBeVisible();
  await expect(page.getByText("El CSV pierde el teléfono.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Responder", exact: true })).toHaveCount(2);
});

test("keeps archived Tasks read-only except for restore", async ({ page }) => {
  await mockApi(page, { archived: true });
  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByText("Task archivada", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restaurar Task" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar title" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Crear Question" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Guardar Spec" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Subir secuencialmente" })).toHaveCount(0);
});

test("shows runner liveness and resumes a paused Task", async ({ page }) => {
  await mockApi(page, { paused: true });
  await page.goto(`/tasks/${taskId}`);
  await expect(page.locator('[aria-label="Runner activo"]:visible')).toBeVisible();
  await expect(page.getByText("Automatización pausada")).toBeVisible();
  const resumeRequest = page.waitForRequest((request) =>
    request.url().endsWith(`/api/v1/tasks/${taskId}/automation/resume`),
  );
  await page.getByRole("button", { name: "Reanudar automatización" }).click();
  await resumeRequest;
  await expect(page.getByText("Automatización pausada")).toHaveCount(0);
  await expect(page.getByText("Automatización reanudada")).toBeVisible();
});

test("edits the request in Draft and freezes it after sending to the curator", async ({ page }) => {
  await mockApi(page, { draft: true });
  await page.goto(`/tasks/${taskId}`);
  const editor = page.getByLabel("User Request", { exact: true });
  await expect(editor).toBeVisible();
  await editor.fill("Petición final antes de curation.");
  await page.getByRole("button", { name: "Guardar petición" }).click();
  await expect(editor).toHaveValue("Petición final antes de curation.");
  await page.getByRole("button", { name: "Enviar a curator" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Enviar a curator" }).click();
  await expect(page.getByText("Petición congelada al enviarse a curation.")).toBeVisible();
  await expect(page.getByLabel("User Request", { exact: true })).toHaveCount(0);
});

test("shows shadcn notifications at the top right", async ({ page }) => {
  await mockApi(page, { draft: true });
  await page.goto(`/tasks/${taskId}`);
  await page.getByLabel("User Request", { exact: true }).fill("Petición que dispara el toast.");
  await page.getByRole("button", { name: "Guardar petición" }).click();
  await expect(page.getByText("User Request guardada")).toBeVisible();
  const toaster = page.locator("[data-sonner-toaster]");
  await expect(toaster).toHaveAttribute("data-x-position", "right");
  await expect(toaster).toHaveAttribute("data-y-position", "top");
  await expect(toaster).toHaveCSS("position", "fixed");
  const toast = page.locator("[data-sonner-toast]", { hasText: "User Request guardada" });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-type", "success");
  await expect(toast).toHaveAttribute("data-rich-colors", "true");
  await expect(toast).toHaveCSS("display", "flex");
  const close = toast.locator("[data-close-button]");
  await expect(close).toBeVisible();
  await close.click();
  await expect(toast).toBeHidden();
});

test("preserves the Curator Spec draft and keeps Ready blocked on a version conflict", async ({
  page,
}) => {
  await mockApi(page, { conflict: true, taskStatus: "curating" });
  await page.goto(`/tasks/${taskId}`);
  await openInspectorIfNeeded(page);
  const editor = page.getByLabel("Curator Spec Markdown");
  await editor.fill("# Borrador local\nNo perder este contenido.");
  await page.getByRole("button", { name: "Guardar Spec" }).click();
  await expect(page.getByText("La Task cambió mientras editabas")).toBeVisible();
  await expect(editor).toHaveValue("# Borrador local\nNo perder este contenido.");
  await expect(page.getByText("Versión leída: 4; versión actual: 5.")).toBeVisible();
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.getByRole("button", { name: "Cerrar inspector" }).click();
  }
  await expect(page.getByRole("button", { name: "Marcar Ready" })).toBeDisabled();
  await expect(page.getByText("Ready bloqueado por cambios sin guardar")).toBeVisible();
});

test("uses a focus-managed dialog for destructive actions", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${taskId}`);
  await openAttachments(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  const trigger = page.getByRole("button", { name: "Eliminar" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Eliminar attachment" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press("Tab");
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("shows Run logs inside the Task and handles attempts without captured logs", async ({
  page,
}) => {
  await mockApi(page, { runs: true });
  await page.goto(`/tasks/${taskId}`);

  const implementationCard = page
    .getByText("Run de Implementation · intento 2", { exact: true })
    .locator("xpath=ancestor::*[@data-slot='card'][1]");
  await implementationCard.getByRole("button", { name: "Logs", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Logs · Intento 2" })).toBeVisible();
  await expect(dialog.getByText("turn.completed", { exact: true })).toBeVisible();
  await dialog.getByText("Ver NDJSON formateado").click();
  await expect(dialog.getByText('"type": "turn.completed"')).toBeVisible();
  await dialog.getByRole("button", { name: "Cerrar" }).click();
  await expect(dialog).toBeHidden();

  await page.goto(`/tasks/${taskId}`);

  const curationCard = page
    .getByText("Run de Curation · intento 1", { exact: true })
    .locator("xpath=ancestor::*[@data-slot='card'][1]");
  const historicalLogs = curationCard.getByRole("button", { name: "Logs", exact: true });
  await historicalLogs.focus();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Logs · Intento 1" })).toBeVisible();
  await expect(dialog.getByText("No se capturaron logs para este Run.")).toBeVisible();
  await expect(
    dialog.getByText("Runner failed before Codex produced an event stream."),
  ).toBeVisible();
});

test("keeps Curation history free from branch and publishing details", async ({ page }) => {
  await mockApi(page, { runs: true });
  await page.goto(`/tasks/${taskId}`);

  const curationCard = page
    .getByText("Run de Curation · intento 1", { exact: true })
    .locator("xpath=ancestor::*[@data-slot='card'][1]");
  await expect(curationCard).toBeVisible();
  await expect(curationCard.getByText(/Rama:|publicación/)).toHaveCount(0);
});

test("opens the mobile inspector as a focus-managed Sheet", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${taskId}`);

  if ((page.viewportSize()?.width ?? 1280) >= 1024) {
    await expect(page.getByRole("complementary", { name: "Inspector de la Task" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir inspector" })).toHaveCount(0);
    return;
  }
  const trigger = page.getByRole("button", { name: "Abrir inspector" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Inspector de la Task" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Cerrar inspector" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() => sheet.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press("Tab");
  await expect
    .poll(() => sheet.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  const spec = sheet.getByLabel("Curator Spec Markdown");
  await spec.fill("# Borrador conservado en el Sheet");
  await sheet.getByRole("button", { name: "Cerrar inspector" }).click();
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(sheet.getByLabel("Curator Spec Markdown")).toHaveValue(
    "# Borrador conservado en el Sheet",
  );
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("keeps Run cancel accessible on desktop and mobile", async ({ page }) => {
  await mockApi(page, { runs: true, runControls: "active" });
  await page.goto(`/tasks/${taskId}`);
  const cancelRequest = page.waitForRequest((request) =>
    request.url().endsWith(`/runs/${runWithLogs.id}/cancel`),
  );
  await page.getByRole("button", { name: "Cancelar Run" }).click();
  await cancelRequest;
});

test("keeps Run retry accessible without horizontal overflow", async ({ page }) => {
  await mockApi(page, { runs: true, runControls: "retry" });
  await page.goto(`/tasks/${taskId}`);
  const retry = page.getByRole("button", { name: "Reintentar", exact: true });
  await retry.focus();
  await expect(retry).toBeFocused();
  const retryRequest = page.waitForRequest((request) =>
    request.url().endsWith(`/runs/${runWithLogs.id}/retry`),
  );
  await page.keyboard.press("Enter");
  await retryRequest;
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("associates validation errors and focuses the first invalid field", async ({ page }) => {
  await mockApi(page);
  await page.goto("/notifications");

  const baseUrl = page.getByLabel("URL base");
  await baseUrl.fill("url-inválida");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();

  await expect(baseUrl).toBeFocused();
  await expect(baseUrl).toHaveAttribute("aria-invalid", "true");
  const describedBy = await baseUrl.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(
    "Introduce una URL HTTP o HTTPS válida.",
  );
  await expect(page.getByRole("alert")).toHaveCount(1);
});

test("supports complete keyboard entry and focus restoration in Dialog and Combobox", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto(`/tasks/new?projectId=${project.id}`);

  const projectCombobox = page.getByRole("combobox", { name: "Project" });
  await projectCombobox.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("combobox", { name: "Buscar Project…" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(projectCombobox).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const search = page.getByRole("combobox", { name: "Buscar Project…" });
  await search.fill("AIWS");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(search).toHaveCount(0);
  await expect(projectCombobox).toBeFocused();

  await page.goto(`/tasks/${taskId}`);
  const createQuestion = page.getByRole("button", { name: "Crear Question" }).first();
  await createQuestion.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Crear Question" });
  await expect(dialog.getByLabel("Texto")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press("Tab");
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(createQuestion).toBeFocused();
});

test("keeps Task snapshots stale and refreshes active queries after reconnection", async ({
  page,
}) => {
  await mockApi(page);
  let healthy = true;
  let taskReads = 0;
  let timelineReads = 0;
  let mutations = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET" && request.method() !== "HEAD") mutations += 1;
    if (path === `/api/v1/tasks/${taskId}` && request.method() === "GET") taskReads += 1;
    if (path === `/api/v1/tasks/${taskId}/timeline` && request.method() === "GET")
      timelineReads += 1;
  });
  await page.route("**/api/v1/health", (route) =>
    healthy
      ? route.fulfill({ json: { status: "ok", version: "0.8.0" } })
      : route.fulfill({ status: 503, json: { status: "unhealthy", version: "0.8.0" } }),
  );

  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByRole("heading", { name: activeTask.title })).toBeVisible();
  await expect(page.getByText(/^Actualizado /).first()).toBeVisible();
  const initialTaskReads = taskReads;
  const initialTimelineReads = timelineReads;

  healthy = false;
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("button", { name: "Reintentar conexión" })).toBeVisible();
  await expect(page.getByText(/^Snapshot actualizado /).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: activeTask.title })).toBeVisible();

  await page.getByRole("button", { name: "Reintentar conexión" }).click();
  await expect(page.getByRole("button", { name: "Reintentar conexión" })).toBeVisible();
  healthy = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("button", { name: "Reintentar conexión" })).toHaveCount(0);
  await expect.poll(() => taskReads).toBeGreaterThan(initialTaskReads);
  await expect.poll(() => timelineReads).toBeGreaterThan(initialTimelineReads);
  expect(mutations).toBe(0);
});

for (const viewport of [
  { name: "360x800", width: 360, height: 800, textScale: 1 },
  { name: "412x915", width: 412, height: 915, textScale: 1 },
  { name: "1280x800", width: 1280, height: 800, textScale: 1 },
  { name: "1440x900", width: 1440, height: 900, textScale: 1 },
  { name: "1280x800 at 200% text", width: 1280, height: 800, textScale: 2 },
] as const) {
  test(`contains extreme content at ${viewport.name}`, async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "La matriz fija sus propios viewports y se ejecuta una sola vez.",
    );
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockApi(page, { extremeStrings: true, runs: true });

    for (const path of ["/tasks", "/projects", `/tasks/${taskId}`]) {
      await page.goto(path);
      if (viewport.textScale === 2) {
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
      }
      await expect(page.locator("main")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          ),
        )
        .toBe(false);
    }
  });
}
