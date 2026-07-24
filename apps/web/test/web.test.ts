import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorNotice, StatusBadge } from "../src/components/common.tsx";
import { filterComboboxOptions } from "../src/components/ui/combobox.tsx";
import { Select, SelectTrigger, SelectValue } from "../src/components/ui/select.tsx";
import { ApiError, apiFieldMessage, mapApiError, unauthorizedRedirect } from "../src/lib/api.ts";
import { preserveConflict } from "../src/lib/conflict.ts";
import { formatRelativeAge, shouldRefreshAfterHealth } from "../src/lib/connectivity.tsx";
import { firstApiErrorPath } from "../src/lib/form-state.tsx";
import { renderSafeMarkdown } from "../src/lib/markdown.ts";
import { catalogSelection } from "../src/lib/model-catalog.ts";
import { answerPayload, questionPayload } from "../src/lib/questions.ts";
import {
  cycleNumberMap,
  parseRunLogRows,
  presentTaskEvent,
  primaryTaskAction,
  selectRelevantRun,
} from "../src/lib/task-detail-view.ts";
import {
  mergePageItems,
  parseProjectFilters,
  parseTaskFilters,
  protectedRedirect,
  serializeProjectFilters,
  serializeTaskFilters,
} from "../src/lib/query.ts";
import type { Question, Run, Task, TimelineItem } from "../src/lib/types.ts";
import { retryUploadEntries } from "../src/lib/upload-queue.tsx";
import { classifyLoginError, safeRedirect } from "../src/pages/login.tsx";
import { formatRunLogs } from "../src/pages/task-detail.tsx";
import { validateFiles } from "../src/pages/tasks.tsx";

describe("Select", () => {
  test("renders the selected item label before the popup mounts", () => {
    const projectId = "prj_01K0ABCDEFGHJKMNPQRSTVWXYZ";
    const markup = renderToStaticMarkup(
      createElement(
        Select,
        {
          items: [{ value: projectId, label: "AIWS" }],
          value: projectId,
        },
        createElement(SelectTrigger, null, createElement(SelectValue)),
      ),
    );
    const visibleText = markup.replaceAll(/<[^>]+>/g, "");

    expect(visibleText).toContain("AIWS");
    expect(visibleText).not.toContain(projectId);
  });
});

describe("Shared form controls", () => {
  test("filters Combobox options locally without allowing a new value", () => {
    const options = [
      { value: "prj_1", label: "AIWS", description: "Workspace local" },
      { value: "prj_2", label: "Webinars", description: "Repositorio gestionado" },
    ];

    expect(filterComboboxOptions(options, "gestionado").map((option) => option.value)).toEqual([
      "prj_2",
    ]);
    expect(filterComboboxOptions(options, "inexistente")).toEqual([]);
  });

  test("maps the first API field error for focus", () => {
    const error = new ApiError(422, "validation_error", "Invalid", "req_1", {
      fields: [
        { path: "topic", message: "Required" },
        { path: "baseUrl", message: "Invalid" },
      ],
    });

    expect(firstApiErrorPath(error)).toBe("topic");
  });

  test("leaves field validation announcements to the associated FieldError", () => {
    const fieldError = new ApiError(422, "validation_error", "Invalid", null, {
      fields: [{ path: "topic", message: "Required" }],
    });
    const requestError = new ApiError(503, "unavailable", "Unavailable", null);

    expect(renderToStaticMarkup(createElement(ErrorNotice, { error: fieldError }))).not.toContain(
      'role="alert"',
    );
    expect(renderToStaticMarkup(createElement(ErrorNotice, { error: requestError }))).toContain(
      'role="alert"',
    );
  });

  test("retries only failed uploads and preserves successful entries", () => {
    const uploaded = { file: new File(["ok"], "ok.txt"), status: "uploaded" as const };
    const failed = {
      file: new File(["bad"], "bad.txt"),
      status: "failed" as const,
      error: "Falló",
    };

    const result = retryUploadEntries([uploaded, failed]);

    expect(result[0]).toBe(uploaded);
    expect(result[1]).toEqual({ file: failed.file, status: "pending" });
  });
});

describe("Connectivity freshness", () => {
  test("formats snapshot age without future or sub-second values", () => {
    const now = Date.parse("2026-07-25T10:00:00.000Z");

    expect(formatRelativeAge(now, now)).toBe("ahora");
    expect(formatRelativeAge(now - 42_000, now)).toBe("hace 42 s");
    expect(formatRelativeAge(now - 5 * 60_000, now)).toBe("hace 5 min");
    expect(formatRelativeAge(now - 3 * 3_600_000, now)).toBe("hace 3 h");
    expect(formatRelativeAge(now + 60_000, now)).toBe("ahora");
  });

  test("refreshes active reads only after a real offline transition", () => {
    expect(shouldRefreshAfterHealth("offline")).toBe(true);
    expect(shouldRefreshAfterHealth("checking")).toBe(false);
    expect(shouldRefreshAfterHealth("online")).toBe(false);
  });
});

describe("Status presentation", () => {
  test("renders Curating with its own label, icon and cyan palette", () => {
    const markup = renderToStaticMarkup(createElement(StatusBadge, { status: "curating" }));

    expect(markup).toContain("Curating");
    expect(markup).toContain("lucide-sparkles");
    expect(markup).toContain("border-cyan-300");
    expect(markup).toContain("text-cyan-900");
  });
});

describe("Task Detail presentation", () => {
  test("selects the active Run before the latest recoverable failure", () => {
    const failed = {
      id: "run_failed",
      cycleId: "cyc_current",
      status: "failed",
    } as Run;
    const active = {
      id: "run_active",
      cycleId: "cyc_current",
      status: "running",
    } as Run;
    const historical = {
      id: "run_old",
      cycleId: "cyc_old",
      status: "running",
    } as Run;

    expect(selectRelevantRun([failed, active, historical], "cyc_current")?.id).toBe("run_active");
    expect(selectRelevantRun([failed, historical], "cyc_current")?.id).toBe("run_failed");
  });

  test("derives the primary action from Task state without inventing transitions", () => {
    expect(primaryTaskAction({ status: "blocked", archivedAt: null } as Task)).toEqual({
      kind: "answer",
      label: "Responder Questions",
    });
    expect(primaryTaskAction({ status: "done", archivedAt: null } as Task)).toEqual({
      kind: "message",
      label: "Solicitar cambio",
    });
    expect(primaryTaskAction({ status: "ready", archivedAt: null } as Task)).toMatchObject({
      kind: "transition",
      nextStatus: "implementing",
    });
    expect(
      primaryTaskAction({ status: "ready", archivedAt: "2026-07-24T10:00:00.000Z" } as Task),
    ).toEqual({ kind: "restore", label: "Restaurar Task" });
  });

  test("resolves Cycle numbers from current state and cycle_created events", () => {
    const items = [
      {
        kind: "event",
        cycleId: "cyc_2",
        event: {
          type: "cycle_created",
          metadata: { cycleId: "cyc_2", number: 2 },
        },
      },
      { kind: "message", cycleId: "cyc_3" },
    ] as TimelineItem[];
    const numbers = cycleNumberMap({ id: "cyc_3", number: 3 } as Task["currentCycle"], items);

    expect(numbers.get("cyc_2")).toBe(2);
    expect(numbers.get("cyc_3")).toBe(3);
  });

  test("translates Activity and only exposes allowlisted metadata", () => {
    const presentation = presentTaskEvent({
      type: "status_changed",
      actorType: "system",
      metadata: {
        from: "ready",
        to: "implementing",
        reason: "Claim atómico",
        taskVersion: 5,
        secret: "never render",
      },
    });

    expect(presentation.label).toBe("Estado cambiado");
    expect(presentation.actor).toBe("Sistema");
    expect(presentation.summary).toBe("ready → implementing · Claim atómico");
    expect(presentation.metadata).toEqual({
      from: "ready",
      to: "implementing",
      reason: "Claim atómico",
      taskVersion: 5,
    });
  });

  test("parses NDJSON into readable rows while preserving raw diagnostics", () => {
    expect(
      parseRunLogRows(
        '{"type":"turn.completed","summary":"Cambios aplicados"}\nplain diagnostic\n',
      ),
    ).toEqual([
      {
        id: "0-turn.completed",
        label: "turn.completed",
        detail: "Cambios aplicados",
        raw: '{\n  "type": "turn.completed",\n  "summary": "Cambios aplicados"\n}',
      },
      {
        id: "1-diagnostic",
        label: "Diagnóstico 2",
        detail: "plain diagnostic",
        raw: "plain diagnostic",
      },
    ]);
  });
});

const baseQuestion: Question = {
  id: "qst_01K0ABCDEFGHJKMNPQRSTVWXYZ",
  taskId: "tsk_01K0ABCDEFGHJKMNPQRSTVWXYZ",
  text: "¿Dónde?",
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
};

describe("Model catalog selection", () => {
  const models = [
    {
      id: "default",
      name: "Default",
      description: "",
      isDefault: true,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium"],
    },
    {
      id: "other",
      name: "Other",
      description: "",
      isDefault: false,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: ["high"],
    },
  ];

  test("uses catalog defaults and changes effort with the selected model", () => {
    expect(catalogSelection(models, "", "")).toEqual({
      modelId: "default",
      reasoningEffort: "medium",
    });
    expect(catalogSelection(models, "other", "medium")).toEqual({
      modelId: "other",
      reasoningEffort: "high",
    });
  });
});

describe("Question forms", () => {
  test("builds definitions for the three question types", () => {
    expect(
      questionPayload({ type: "text", text: "Detalle", options: ["ignored"], allowOther: false })
        .options,
    ).toEqual([]);
    expect(
      questionPayload({
        type: "single_choice",
        text: "Entorno",
        options: ["Prod", "Test"],
        allowOther: true,
      }).options,
    ).toEqual(["Prod", "Test"]);
    expect(
      questionPayload({
        type: "multiple_choice",
        text: "Áreas",
        options: ["API", "Web"],
        allowOther: false,
      }).type,
    ).toBe("multiple_choice");
  });

  test("validates answers according to type", () => {
    expect(() => answerPayload(baseQuestion, [], "")).toThrow();
    expect(answerPayload(baseQuestion, [], "Producción")).toEqual({
      selectedOptionIds: [],
      answerText: "Producción",
    });
    const choice: Question = {
      ...baseQuestion,
      type: "single_choice",
      options: [
        { id: "opt_01K0ABCDEFGHJKMNPQRSTVWXYZ", label: "Prod", position: 0 },
        { id: "opt_01K0ABCDEFGHJKMNPQRSTVWXY0", label: "Test", position: 1 },
      ],
    };
    expect(
      answerPayload(choice, [choice.options[0]?.id as string], "").selectedOptionIds,
    ).toHaveLength(1);
    expect(() => answerPayload(choice, [], "")).toThrow();
  });
});

describe("Conflict handling", () => {
  test("preserves the local draft and both known versions", () => {
    const conflict = preserveConflict(
      new ApiError(409, "version_conflict", "Conflict", "req_1", { currentVersion: 8 }),
      "local spec",
      7,
    );
    expect(conflict).toEqual({ draft: "local spec", readVersion: 7, currentVersion: 8 });
  });
});

describe("Markdown security", () => {
  test("escapes raw HTML while retaining safe Markdown", () => {
    const html = renderSafeMarkdown("# Spec\n<script>alert(1)</script>\n**safe**");
    expect(html).toContain("<h1>Spec</h1>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<strong>safe</strong>");
  });
});

describe("Query and API boundaries", () => {
  test("formats NDJSON Run logs while preserving plain diagnostics", () => {
    expect(formatRunLogs('{"type":"turn.completed"}\nplain diagnostic\n')).toBe(
      '{\n  "type": "turn.completed"\n}\n\nplain diagnostic',
    );
  });

  test("serializes repeated statuses and stable API names", () => {
    expect(
      serializeTaskFilters({
        projectId: "prj_1",
        status: ["draft", "ready"],
        sort: "createdAt",
        order: "asc",
        archived: true,
      }),
    ).toBe("?projectId=prj_1&status=draft&status=ready&archived=true&sort=createdAt&order=asc");
  });

  test("parses URL filter values and restores documented defaults", () => {
    expect(
      parseTaskFilters({
        projectId: "prj_1",
        status: ["curating", "ready"],
        archived: "true",
        sort: "createdAt",
        order: "asc",
      }),
    ).toEqual({
      projectId: "prj_1",
      status: ["curating", "ready"],
      archived: true,
      sort: "createdAt",
      order: "asc",
    });
    expect(parseTaskFilters({})).toEqual({
      archived: false,
      sort: "updatedAt",
      order: "desc",
    });
    expect(parseProjectFilters({ gitProvider: "github", archived: true })).toEqual({
      gitProvider: "github",
      archived: true,
    });
    expect(serializeProjectFilters({ accountScope: "work", archived: true })).toBe(
      "?accountScope=work&archived=true",
    );
  });

  test("appends cursor pages without duplicating existing rows", () => {
    expect(
      mergePageItems(
        [
          { id: "tsk_1", title: "One" },
          { id: "tsk_2", title: "Two" },
        ],
        [
          { id: "tsk_2", title: "Duplicate" },
          { id: "tsk_3", title: "Three" },
        ],
      ),
    ).toEqual([
      { id: "tsk_1", title: "One" },
      { id: "tsk_2", title: "Two" },
      { id: "tsk_3", title: "Three" },
    ]);
  });

  test("maps the documented error envelope", () => {
    const error = mapApiError(422, {
      error: {
        code: "validation_error",
        message: "Invalid",
        details: { fields: [] },
        requestId: "req_1",
      },
    });
    expect(error.code).toBe("validation_error");
    expect(error.requestId).toBe("req_1");
    const fieldError = new ApiError(422, "validation_error", "Invalid", "req_2", {
      fields: [{ path: "userRequest", message: "Required" }],
    });
    expect(apiFieldMessage(fieldError, "userRequest")).toBe("Required");
  });

  test("route guard retains the requested URL", () => {
    expect(protectedRedirect("/tasks/tsk_1", false)).toBe("/login?redirect=%2Ftasks%2Ftsk_1");
    expect(protectedRedirect("/tasks", true)).toBeNull();
  });

  test("global 401 redirect preserves path, query and hash except for auth endpoints", () => {
    const location = {
      pathname: "/tasks/tsk_1",
      search: "?tab=activity",
      hash: "#run-2",
    };
    expect(unauthorizedRedirect(401, "/tasks/tsk_1", location)).toBe(
      "/login?redirect=%2Ftasks%2Ftsk_1%3Ftab%3Dactivity%23run-2",
    );
    expect(unauthorizedRedirect(401, "/auth/login", location)).toBeNull();
    expect(unauthorizedRedirect(401, "/auth/session", location)).toBeNull();
    expect(unauthorizedRedirect(500, "/tasks/tsk_1", location)).toBeNull();
  });

  test("classifies login credentials, rate limit, network and server errors", () => {
    expect(classifyLoginError(new ApiError(401, "unauthorized", "No", null)).kind).toBe(
      "credentials",
    );
    expect(classifyLoginError(new ApiError(429, "rate_limit", "No", null)).kind).toBe("rate_limit");
    expect(classifyLoginError(new ApiError(0, "network_error", "No", null)).kind).toBe("network");
    expect(classifyLoginError(new ApiError(503, "internal_error", "No", "req_1")).kind).toBe(
      "unexpected",
    );
  });

  test("login preserves a safe full return URL", () => {
    expect(safeRedirect("/tasks/tsk_1?tab=activity#run-2", "https://aiws.test")).toBe(
      "/tasks/tsk_1?tab=activity#run-2",
    );
    expect(safeRedirect("//evil.test/tasks", "https://aiws.test")).toBe("/tasks");
    expect(safeRedirect("https://evil.test/tasks", "https://aiws.test")).toBe("/tasks");
  });

  test("performs preliminary attachment validation", () => {
    expect(validateFiles([new File(["log"], "output.log")])).toBeNull();
    expect(validateFiles([new File(["x"], "payload.exe")])).toContain("extensión");
    expect(
      validateFiles(Array.from({ length: 11 }, (_, index) => new File(["x"], `${index}.txt`))),
    ).toContain("10 attachments");
    expect(validateFiles([new File(["x"], "more.txt")], 10)).toContain("quedan 0");
  });
});
