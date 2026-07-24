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
  createdAt: "2026-07-21T10:00:00.000Z",
  updatedAt: "2026-07-21T12:00:00.000Z",
  archivedAt: null,
};

const taskId = "tsk_01K0ABCDEFGHJKMNPQRSTVWXYZ";
const cycleId = "cyc_01K0ABCDEFGHJKMNPQRSTVWXYZ";
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
};

const runWithoutLogs = {
  ...runWithLogs,
  id: "run_01K0ABCDEFGHJKMNPQRSTVWXY0",
  kind: "curation",
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
  } = {},
) {
  let questionAnswered = false;
  let notificationSettings = {
    enabled: false,
    baseUrl: "https://ntfy.sh",
    topic: "",
    accessTokenConfigured: false,
    updatedAt: "2026-07-24T10:00:00.000Z",
  };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    const baseTask = {
      ...(options.draft
        ? { ...activeTask, status: "draft", version: 1, curatorSpec: "", questions: [] }
        : options.paused
          ? { ...activeTask, status: "curating", questions: [] }
          : activeTask),
      automationPaused: options.paused ?? false,
    };
    const representedTask = options.runControls
      ? {
          ...baseTask,
          status: options.runControls === "active" ? "implementing" : "ready",
          questions: [],
        }
      : baseTask;
    const representedRuns =
      options.runControls === "active"
        ? [{ ...runWithLogs, status: "running", executionStage: "agent", summary: null }]
        : options.runControls === "retry"
          ? [{ ...runWithLogs, status: "failed", errorMessage: "Push failed." }]
          : [runWithLogs, runWithoutLogs];
    if (path === "/health") return route.fulfill({ json: { status: "ok", version: "0.5.1" } });
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
    if (path === "/connections") return route.fulfill({ json: [] });
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
      return route.fulfill({ json: { items: [project], nextCursor: null } });
    if (path === `/projects/${project.id}` && route.request().method() === "GET")
      return route.fulfill({ json: project });
    if (path === `/projects/${project.id}` && route.request().method() === "PATCH") {
      return route.fulfill({ json: { ...project, ...route.request().postDataJSON() } });
    }
    if (path === "/tasks")
      return route.fulfill({ json: { items: [taskSummary], nextCursor: null } });
    if (path === `/tasks/${taskId}/runs` && options.runs) {
      return route.fulfill({ json: representedRuns });
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
      const questionItems = timelineQuestions.map((question) => ({
        kind: "question",
        cycleId,
        createdAt: question.createdAt,
        question,
        answers: [],
      }));
      const runItems = options.runs
        ? representedRuns.map((run) => ({
            kind: "run",
            cycleId,
            createdAt: run.createdAt,
            run,
          }))
        : [];
      return route.fulfill({ json: { items: [...questionItems, ...runItems], nextCursor: null } });
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
    if (path === `/tasks/${taskId}/transition` && options.draft) {
      return route.fulfill({ json: { ...representedTask, status: "curating", version: 3 } });
    }
    if (path === `/tasks/${taskId}/automation/resume`) {
      return route.fulfill({
        json: { ...representedTask, automationPaused: false, version: representedTask.version + 1 },
      });
    }
    if (path === `/tasks/${taskId}`) {
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

test("selects model and reasoning effort only from the live catalog", async ({ page }) => {
  await mockApi(page);
  await page.goto("/automation");
  const selects = page.getByRole("combobox");
  await expect(selects.nth(1)).toContainText("GPT Default");
  await expect(selects.nth(2)).toContainText("medium");
  await page.getByLabel("Name").fill("Codex profile");
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
  await expect(page.getByRole("button", { name: "Activar Implementation" })).toBeDisabled();

  const selects = page.getByRole("combobox");
  await selects.nth(2).click();
  await page.getByRole("option", { name: "Curator" }).click();
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(page.getByText("Automatización guardada")).toBeVisible();
});

test("configures masked ntfy notifications and keeps the mobile layout accessible", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Notificaciones", exact: true })).toBeVisible();
  await expect(page.getByText("Un topic sin autenticación puede ser público.")).toBeVisible();
  await page.getByRole("checkbox", { name: "Activar notificaciones" }).click();
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
  await page.getByRole("button", { name: "Enviar prueba" }).click();
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
  await page.getByRole("button", { name: "Enviar prueba" }).click();
  await expect(page.getByText("req_ntfy_failed")).toBeVisible();
  await expect(page.getByText("secret upstream body")).toHaveCount(0);
});

test("hides the credential reference for a ChatGPT session", async ({ page }) => {
  await mockApi(page);
  await page.goto("/automation");
  const catalogRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/v1/agent-profiles/model-catalog") &&
      request.postDataJSON().authMode === "chatgpt_session",
  );
  await page.getByLabel("Auth mode").click();
  await page.getByRole("option", { name: "Sesión ChatGPT" }).click();
  await expect(page.getByLabel("Credential env reference")).toHaveCount(0);
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
  await page.getByRole("button", { name: "Responder" }).first().click();

  await expect(page.getByText("Question respondida", { exact: true })).toBeVisible();
  await expect(page.getByText("El CSV pierde el teléfono.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Responder" })).toHaveCount(2);
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

test("preserves the Curator Spec draft on a version conflict", async ({ page }) => {
  await mockApi(page, { conflict: true });
  await page.goto(`/tasks/${taskId}`);
  const editor = page.getByLabel("Curator Spec Markdown");
  await editor.fill("# Borrador local\nNo perder este contenido.");
  await page.getByRole("button", { name: "Guardar Spec" }).click();
  await expect(page.getByText("La Task cambió mientras editabas")).toBeVisible();
  await expect(editor).toHaveValue("# Borrador local\nNo perder este contenido.");
  await expect(page.getByText("Versión leída: 4; versión actual: 5.")).toBeVisible();
});

test("uses a focus-managed dialog for destructive actions", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/tasks/${taskId}`);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Eliminar" }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Eliminar attachment" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("shows Run logs inside the Task and handles attempts without captured logs", async ({
  page,
}) => {
  await mockApi(page, { runs: true });
  await page.goto(`/tasks/${taskId}`);

  await page.getByRole("button", { name: "Logs" }).first().click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Logs · Attempt 2" })).toBeVisible();
  await expect(dialog.getByText('"type": "turn.completed"')).toBeVisible();
  await dialog.getByRole("button", { name: "Cerrar" }).click();
  await expect(dialog).toBeHidden();

  await page.goto(`/tasks/${taskId}`);

  const historicalLogs = page.getByRole("button", { name: "Logs" }).nth(1);
  await historicalLogs.focus();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Logs · Attempt 1" })).toBeVisible();
  await expect(dialog.getByText("No se capturaron logs para este Run.")).toBeVisible();
  await expect(
    dialog.getByText("Runner failed before Codex produced an event stream."),
  ).toBeVisible();
});

test("keeps Run cancel accessible on desktop and mobile", async ({ page }) => {
  await mockApi(page, { runs: true, runControls: "active" });
  await page.goto(`/tasks/${taskId}`);
  const cancelRequest = page.waitForRequest((request) =>
    request.url().endsWith(`/runs/${runWithLogs.id}/cancel`),
  );
  await page.getByRole("button", { name: "Cancelar" }).click();
  await cancelRequest;
});

test("keeps Run Retry accessible without horizontal overflow", async ({ page }) => {
  await mockApi(page, { runs: true, runControls: "retry" });
  await page.goto(`/tasks/${taskId}`);
  const retry = page.getByRole("button", { name: "Retry", exact: true });
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
