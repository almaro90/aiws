import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Select, SelectTrigger, SelectValue } from "../src/components/ui/select.tsx";
import { ApiError, apiFieldMessage, mapApiError } from "../src/lib/api.ts";
import { preserveConflict } from "../src/lib/conflict.ts";
import { renderSafeMarkdown } from "../src/lib/markdown.ts";
import { catalogSelection } from "../src/lib/model-catalog.ts";
import { answerPayload, questionPayload } from "../src/lib/questions.ts";
import { protectedRedirect, serializeTaskFilters } from "../src/lib/query.ts";
import type { Question } from "../src/lib/types.ts";
import { safeRedirect } from "../src/pages/login.tsx";
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

  test("login preserves a safe full return URL", () => {
    expect(safeRedirect("/tasks/tsk_1?tab=activity", "https://aiws.test")).toBe(
      "/tasks/tsk_1?tab=activity",
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
  });
});
