import { describe, expect, test } from "bun:test";
import { RunnerControlServer } from "../src/control-server.ts";
import { modelArguments } from "../src/codex.ts";
import { catalogDockerArguments, CodexModelCatalog, withTimeout } from "../src/model-catalog.ts";

describe("Codex model catalog", () => {
  test("keeps stdin attached to the ephemeral app-server container", () => {
    expect(catalogDockerArguments("catalog", "runtime")).toContain("-i");
  });

  test("initializes JSON-RPC, paginates model/list and normalizes efforts", async () => {
    const process = fakeAppServer("success");
    const catalog = adapter();
    try {
      expect(await catalog.readAppServer(process)).toEqual({
        models: [
          {
            id: "gpt-default",
            name: "GPT Default",
            description: "Fixture model",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["medium", "high"],
          },
          {
            id: "gpt-second",
            name: "GPT Second",
            description: "Fixture model",
            isDefault: false,
            defaultReasoningEffort: "low",
            supportedReasoningEfforts: ["low"],
          },
        ],
      });
    } finally {
      process.kill();
      await process.exited;
    }
  });

  test("rejects malformed catalogs and premature exits", async () => {
    for (const mode of ["malformed", "early_exit"]) {
      const process = fakeAppServer(mode);
      try {
        expect(adapter().readAppServer(process)).rejects.toThrow();
      } finally {
        process.kill();
        await process.exited;
      }
    }
  });

  test("applies a bounded timeout", async () => {
    expect(withTimeout(new Promise(() => undefined), 5)).rejects.toThrow("timed out");
  });

  test("requires the control secret using a constant-time boundary", async () => {
    const catalog = {
      list: async () => ({ models: [] }),
    };
    const control = new RunnerControlServer(1, "x".repeat(32), catalog as never, false);
    expect(
      (
        await control.fetch(
          new Request("http://runner/internal/model-catalog", {
            method: "POST",
            headers: { Authorization: `Bearer ${"y".repeat(32)}` },
            body: JSON.stringify({
              authMode: "api_key",
              credentialReference: "OPENAI_API_KEY",
            }),
          }),
        )
      ).status,
    ).toBe(403);
  });

  test("maps missing credentials to catalog_unavailable without exposing them", async () => {
    const secret = "x".repeat(32);
    const control = new RunnerControlServer(
      1,
      secret,
      { list: async () => Promise.reject(new Error("sk-super-secret")) } as never,
      false,
    );
    const response = await control.fetch(
      new Request("http://runner/internal/model-catalog", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        body: JSON.stringify({
          authMode: "api_key",
          credentialReference: "MISSING_KEY",
        }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sk-super-secret");
  });
});

describe("Codex Run model arguments", () => {
  test("passes the selected model and reasoning effort without credentials", () => {
    expect(
      modelArguments({
        authMode: "api_key",
        credentialReference: "OPENAI_API_KEY",
        model: "gpt-codex",
        reasoningEffort: "high",
      }),
    ).toEqual(["--model", "gpt-codex", "-c", 'model_reasoning_effort="high"']);
  });

  test("preserves automatic behavior for legacy null profiles", () => {
    expect(
      modelArguments({
        authMode: "chatgpt_session",
        credentialReference: "CODEX_SESSION",
        model: null,
        reasoningEffort: null,
      }),
    ).toEqual([]);
  });
});

function adapter(): CodexModelCatalog {
  return new CodexModelCatalog(
    "fixture",
    "fixture",
    {} as never,
    "http://proxy/v1",
    "fixture-volume",
  );
}

function fakeAppServer(mode: string): ReturnType<typeof Bun.spawn> {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const stdout = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      if (mode === "early_exit") {
        closed = true;
        controller.close();
      }
    },
  });
  const emit = (value: unknown) => {
    if (!closed) controller.enqueue(new TextEncoder().encode(`${JSON.stringify(value)}\n`));
  };
  const stdin = {
    write(value: string) {
      const message = JSON.parse(value) as {
        readonly id?: number;
        readonly method: string;
        readonly params?: { readonly cursor?: string | null };
      };
      if (message.method === "initialize") {
        emit({ id: message.id, result: { userAgent: "fixture" } });
      } else if (message.method === "model/list" && mode === "malformed") {
        emit({ id: message.id, result: { data: "invalid" } });
      } else if (message.method === "model/list") {
        const second = message.params?.cursor === "page-2";
        emit({
          id: message.id,
          result: {
            data: [
              {
                id: second ? "gpt-second" : "gpt-default",
                displayName: second ? "GPT Second" : "GPT Default",
                description: "Fixture model",
                isDefault: !second,
                defaultReasoningEffort: second ? "low" : "medium",
                supportedReasoningEfforts: second
                  ? [{ reasoningEffort: "low" }]
                  : [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }],
              },
            ],
            nextCursor: second ? null : "page-2",
          },
        });
      }
      return value.length;
    },
    flush: async () => undefined,
  };
  return {
    stdin,
    stdout,
    stderr: new ReadableStream(),
    exited: Promise.resolve(0),
    kill() {
      if (!closed) {
        closed = true;
        controller.close();
      }
    },
  } as unknown as ReturnType<typeof Bun.spawn>;
}
