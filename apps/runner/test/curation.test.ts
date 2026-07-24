import { describe, expect, test } from "bun:test";
import {
  appendRunnerDiagnostic,
  curationQuestions,
  failureDiagnostics,
  RunLogBuffer,
  runnerErrorLog,
} from "../src/codex.ts";
import { curationOutputSchema, normalizeCurationOutput } from "../src/curation.ts";

describe("managed curation output", () => {
  test("renders selected option labels in the curator context", () => {
    expect(
      curationQuestions([
        {
          text: "What response body should the endpoint return?",
          type: "single_choice",
          status: "answered",
          answerText: null,
          selectedOptionIds: ["opt_opaque"],
          options: [
            { id: "opt_other", label: "Plain text" },
            { id: "opt_opaque", label: 'JSON { "message": "Hello" }' },
          ],
        },
      ]),
    ).toContain('selected=JSON { "message": "Hello" }');
  });

  test("uses a Structured Outputs-compatible root object", () => {
    expect(curationOutputSchema.type).toBe("object");
    expect(curationOutputSchema).not.toHaveProperty("oneOf");
    expect(curationOutputSchema.required).toEqual([
      "outcome",
      "title",
      "curatorSpec",
      "questions",
      "summary",
    ]);
  });

  test("normalizes the common structured shape into each API variant", () => {
    expect(
      normalizeCurationOutput({
        outcome: "ready",
        title: null,
        curatorSpec: "# Implementation\nShip it.",
        questions: [],
        summary: "Ready.",
      }),
    ).toEqual({
      outcome: "ready",
      curatorSpec: "# Implementation\nShip it.",
      summary: "Ready.",
    });
    expect(
      normalizeCurationOutput({
        outcome: "blocked",
        title: "Clarify behavior",
        curatorSpec: null,
        questions: [{ text: "Which behavior?", type: "text", options: [], allowOther: false }],
        summary: "Blocked.",
      }),
    ).toEqual({
      outcome: "blocked",
      title: "Clarify behavior",
      questions: [{ text: "Which behavior?", type: "text", options: [], allowOther: false }],
      summary: "Blocked.",
    });
  });

  test("rejects inconsistent outcomes before calling the API", () => {
    expect(() =>
      normalizeCurationOutput({
        outcome: "ready",
        title: null,
        curatorSpec: "",
        questions: [],
        summary: "Invalid.",
      }),
    ).toThrow("Ready curation requires a non-empty Curator Spec.");
    expect(() =>
      normalizeCurationOutput({
        outcome: "blocked",
        title: null,
        curatorSpec: null,
        questions: [],
        summary: "Invalid.",
      }),
    ).toThrow("Blocked curation requires between 1 and 10 Questions.");
  });

  test("surfaces JSON error events without leaking successful agent messages", () => {
    const diagnostics = failureDiagnostics(
      [
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "secret spec" },
        }),
        JSON.stringify({ type: "error", message: "invalid_json_schema sk-secret" }),
      ].join("\n"),
      "Reading additional input from stdin...",
    );
    expect(diagnostics).toContain("invalid_json_schema [REDACTED]");
    expect(diagnostics).not.toContain("secret spec");
  });

  test("serializes early runner failures as one NDJSON event", () => {
    expect(runnerErrorLog("Error: preparation failed")).toBe(
      '{"type":"runner.error","message":"Error: preparation failed"}\n',
    );
  });

  test("keeps the beginning, tail, redaction and final diagnostic within 5 MB", () => {
    const logs = new RunLogBuffer();
    logs.append(`begin sk-secret\n${"x".repeat(5_100_000)}\ntail\n`);
    const snapshot = appendRunnerDiagnostic(logs.snapshot(), "Git push failed");
    expect(new TextEncoder().encode(snapshot).byteLength).toBeLessThanOrEqual(5_000_000);
    expect(snapshot).toContain("begin [REDACTED]");
    expect(snapshot).toContain("runner.logs_truncated");
    expect(snapshot).toContain("tail");
    expect(snapshot).toContain("Git push failed");
    expect(snapshot).not.toContain("sk-secret");
  });
});
