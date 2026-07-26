import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexModelCatalog } from "../src/model-catalog.ts";
import { RunnerReadinessProbe } from "../src/readiness.ts";

const profile = {
  kind: "curation" as const,
  authMode: "api_key" as const,
  credentialReference: "OPENAI_API_KEY",
  model: "gpt-test",
  reasoningEffort: "high",
};

describe("runner readiness probe", () => {
  test("checks infrastructure and model authentication in a stable order", async () => {
    const commands: readonly string[][] = [];
    const recorded: string[][] = commands as string[][];
    const probe = new RunnerReadinessProbe("agent:test", "aiws_test", "/workspaces", catalog(), {
      workspace: async () => true,
      run: async (command) => {
        recorded.push([...command]);
        return 0;
      },
    });

    const checks = await probe.check([profile]);
    expect(checks.map((check) => `${check.id}:${check.status}`)).toEqual([
      "agent_image:pass",
      "workspace:pass",
      "network:pass",
      "container_lifecycle:pass",
      "toolchain:pass",
      "curation_model_authentication:pass",
    ]);
    expect(
      recorded.some((command) => command.slice(0, 3).join(" ") === "docker image inspect"),
    ).toBe(true);
    expect(
      recorded.filter((command) => command.slice(0, 3).join(" ") === "docker rm -f").length,
    ).toBe(2);
  });

  test("skips dependent container checks and never exposes adapter errors", async () => {
    const probe = new RunnerReadinessProbe(
      "agent:test",
      "aiws_test",
      "/workspaces",
      catalog(true),
      {
        workspace: async () => false,
        run: async (command) => (command[1] === "image" ? 1 : 0),
      },
    );

    const checks = await probe.check([profile]);
    expect(checks.map((check) => `${check.id}:${check.status}`)).toEqual([
      "agent_image:fail",
      "workspace:fail",
      "network:pass",
      "container_lifecycle:skipped",
      "toolchain:skipped",
      "curation_model_authentication:fail",
    ]);
    expect(JSON.stringify(checks)).not.toContain("sensitive");
  });

  test("cleans every acquired workspace and container after success or failure", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "aiws-readiness-test-"));
    try {
      for (const failedProbe of ["none", "container_lifecycle", "toolchain"] as const) {
        const removals: string[] = [];
        const probe = new RunnerReadinessProbe("agent:test", "aiws_test", workspace, catalog(), {
          run: async (command) => {
            if (command.slice(0, 3).join(" ") === "docker rm -f") {
              removals.push(command[3] ?? "");
              return 0;
            }
            if (
              command[0] === "docker" &&
              command[1] === "run" &&
              ((failedProbe === "container_lifecycle" && command.at(-1) === "true") ||
                (failedProbe === "toolchain" &&
                  command.includes("git --version >/dev/null && codex --version >/dev/null")))
            ) {
              return 1;
            }
            return 0;
          },
        });

        const checks = await probe.check([]);
        expect(await readdir(workspace)).toEqual([]);
        expect(removals.length).toBe(failedProbe === "container_lifecycle" ? 1 : 2);
        expect(new Set(removals).size).toBe(removals.length);
        expect(checks.find((check) => check.id === failedProbe)?.status).toBe(
          failedProbe === "none" ? undefined : "fail",
        );
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("cleans an acquired container when the request is cancelled", async () => {
    const controller = new AbortController();
    const removals: string[] = [];
    const probe = new RunnerReadinessProbe("agent:test", "aiws_test", "/workspaces", catalog(), {
      workspace: async () => true,
      run: async (command, _timeout, signal) => {
        if (command.slice(0, 3).join(" ") === "docker rm -f") {
          removals.push(command[3] ?? "");
          return 0;
        }
        if (command[0] === "docker" && command[1] === "run") {
          controller.abort();
          if (signal?.aborted) throw new Error("cancelled");
        }
        return 0;
      },
    });

    const checks = await probe.check([], controller.signal);
    expect(checks.find((check) => check.id === "container_lifecycle")?.status).toBe("fail");
    expect(removals).toHaveLength(1);
  });
});

function catalog(fail = false): CodexModelCatalog {
  return {
    list: async () => {
      if (fail) throw new Error("sensitive credential error");
      return {
        models: [
          {
            id: "gpt-test",
            name: "Test",
            description: "",
            isDefault: true,
            defaultReasoningEffort: "high",
            supportedReasoningEfforts: ["high"],
          },
        ],
      };
    },
  } as unknown as CodexModelCatalog;
}
