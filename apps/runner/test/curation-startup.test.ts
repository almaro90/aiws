import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Assignment } from "../src/client.ts";
import { materializeCurationContext } from "../src/curation.ts";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("curation runner startup", () => {
  test("materializes the curation schema before a Run can advance", async () => {
    const workspaces = await mkdtemp(join(tmpdir(), "aiws-curation-startup-"));
    directories.push(workspaces);
    const runId = `run_${"0".repeat(26)}`;
    const assignment = {
      run: {
        id: runId,
        taskId: `tsk_${"0".repeat(26)}`,
        branchName: null,
        kind: "curation",
        status: "queued",
        executionStage: "agent",
        resumeFromRunId: null,
        baseSha: null,
        headSha: null,
        summary: null,
        verificationContractRevision: null,
        verificationWaiverRunId: null,
      },
      task: {
        id: `tsk_${"0".repeat(26)}`,
        title: "Curate fixture",
        userRequest: "Produce a specification.",
        curatorSpec: "",
        version: 2,
        currentCycleId: `cyc_${"0".repeat(26)}`,
        questions: [],
        attachments: [],
        cycles: [],
        messages: [],
        specRevisions: [],
      },
      project: {
        id: `prj_${"0".repeat(26)}`,
        repositoryPath: "/repositories/fixture.git",
        remoteFullName: "test/fixture",
        defaultBranch: "main",
      },
      agentProfile: {
        authMode: "api_key",
        credentialReference: "OPENAI_API_KEY",
        model: "gpt-test",
        reasoningEffort: "medium",
      },
      delivery: null,
      verificationContract: null,
    } satisfies Assignment;

    await materializeCurationContext(workspaces, assignment, async () => new Uint8Array());

    const control = join(workspaces, "runs", runId, "control");
    const schemaPath = join(control, "curation-output.schema.json");
    expect(await Bun.file(schemaPath).exists()).toBe(true);
    expect((await stat(control)).mode & 0o777).toBe(0o555);
    expect((await stat(schemaPath)).mode & 0o777).toBe(0o444);
    const schema = (await Bun.file(schemaPath).json()) as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema).not.toHaveProperty("oneOf");
    expect(schema.required).toEqual(["outcome", "title", "curatorSpec", "questions", "summary"]);

    await chmod(control, 0o700);
    await chmod(join(workspaces, "runs", runId, "attachments"), 0o700);
  });
});
