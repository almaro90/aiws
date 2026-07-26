import { mkdir } from "node:fs/promises";
import { AiwsRunnerClient, type Assignment } from "./client.ts";
import {
  appendRunnerDiagnostic,
  buildPrompt,
  CodexExecutionError,
  CodexRuntime,
  PROMPT_BUILDER_VERSION,
} from "./codex.ts";
import { CredentialProxy } from "./credential-proxy.ts";
import { materializeCurationContext, normalizeCurationOutput } from "./curation.ts";
import { GitWorkspaceManager } from "./workspace.ts";
import { CodexModelCatalog } from "./model-catalog.ts";
import { RunnerControlServer } from "./control-server.ts";
import { RunnerReadinessProbe } from "./readiness.ts";
import { VerificationRuntime } from "./verification.ts";

const config = {
  apiUrl: required("AIWS_API_URL"),
  runnerToken: required("AIWS_RUNNER_TOKEN"),
  workspacesDir: Bun.env.AIWS_WORKSPACES_DIR ?? "/workspaces",
  image: Bun.env.AIWS_AGENT_IMAGE ?? "aiws-agent:0.8.0",
  network: Bun.env.AIWS_DOCKER_NETWORK ?? "aiws_default",
  pollMs: integer(Bun.env.AIWS_RUNNER_POLL_MS ?? "15000", 1000),
  proxyPort: integer(Bun.env.AIWS_CREDENTIAL_PROXY_PORT ?? "4317", 1),
  proxyUrl: Bun.env.AIWS_CREDENTIAL_PROXY_URL ?? "http://runner-manager:4317/v1",
  chatgptVolume: Bun.env.AIWS_CODEX_AUTH_VOLUME ?? "aiws-codex-auth",
  workspacesVolume: Bun.env.AIWS_WORKSPACES_VOLUME ?? "aiws-workspaces",
  reconcileMs: integer(Bun.env.AIWS_RUNNER_RECONCILE_MS ?? "60000", 3_000),
  controlPort: integer(Bun.env.AIWS_RUNNER_CONTROL_PORT ?? "4318", 1),
  controlSecret: Bun.env.AIWS_RUNNER_CONTROL_SECRET,
};
await mkdir(config.workspacesDir, { recursive: true, mode: 0o700 });
const client = new AiwsRunnerClient(config.apiUrl, config.runnerToken);
const proxy = new CredentialProxy(config.proxyPort);
const workspaces = new GitWorkspaceManager(config.workspacesDir);
const codex = new CodexRuntime(
  config.image,
  config.network,
  proxy,
  config.proxyUrl,
  config.chatgptVolume,
  config.workspacesVolume,
);
const modelCatalog = new CodexModelCatalog(
  config.image,
  config.network,
  proxy,
  config.proxyUrl,
  config.chatgptVolume,
);
const readiness = new RunnerReadinessProbe(
  config.image,
  config.network,
  config.workspacesDir,
  modelCatalog,
);
const verification = new VerificationRuntime(config.image, config.network, config.workspacesVolume);
const control =
  config.controlSecret === undefined
    ? null
    : new RunnerControlServer(
        config.controlPort,
        config.controlSecret,
        modelCatalog,
        true,
        readiness,
      );

await reconcile();
const reconciliation = setInterval(() => void reconcile(), config.reconcileMs);

let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
  void codex.stopAll();
});
process.on("SIGINT", () => {
  stopping = true;
  void codex.stopAll();
});
while (!stopping) {
  const assignment = await client.claim().catch((error) => {
    console.error(safeError(error));
    return null;
  });
  if (assignment === null) {
    await Bun.sleep(config.pollMs);
    continue;
  }
  await execute(assignment).catch((error) => console.error(safeError(error)));
}
proxy.stop();
control?.stop();
clearInterval(reconciliation);

async function execute(assignment: Assignment): Promise<void> {
  const runId = assignment.run.id;
  let prepared: Awaited<ReturnType<GitWorkspaceManager["prepare"]>> | null = null;
  let latestLogs = "";
  let executionStage = assignment.run.executionStage;
  let summary = assignment.run.summary ?? "Automated implementation completed.";
  let baseSha = assignment.run.baseSha;
  let headSha = assignment.run.headSha;
  const checkpointRunId = assignment.run.resumeFromRunId ?? runId;
  try {
    if (assignment.run.status === "queued") {
      await client.advance(runId, { status: "preparing" });
    }
    if (executionStage === "publishing") {
      if (
        assignment.run.resumeFromRunId === null ||
        assignment.run.baseSha === null ||
        assignment.run.headSha === null
      ) {
        throw new Error("Publishing Retry has no verifiable checkpoint; use a full Retry.");
      }
      prepared = await workspaces.resumePublishing(
        assignment.run.resumeFromRunId,
        assignment.run.baseSha,
        assignment.run.headSha,
      );
      baseSha = prepared.baseSha;
      headSha = assignment.run.headSha;
      await client.advance(runId, {
        status: "running",
        baseSha: prepared.baseSha,
        logsStorageKey: `runs/${runId}.jsonl`,
      });
    } else {
      const preparationCredentials = await client.credentials(runId);
      const baseBranch =
        assignment.delivery?.baseBranch ??
        assignment.project.defaultBranch ??
        preparationCredentials.defaultBranch;
      prepared = await workspaces.prepare(
        runId,
        assignment.project.repositoryPath,
        preparationCredentials.cloneUrl,
        gitAuthentication(preparationCredentials),
        baseBranch,
        assignment.run.branchName,
        assignment.delivery?.branchName ?? baseBranch,
      );
      baseSha = prepared.baseSha;
      await materializeCurationContext(config.workspacesDir, assignment, (taskId, attachmentId) =>
        client.downloadAttachment(taskId, attachmentId),
      );
      await client.advance(runId, {
        status: "running",
        baseSha: prepared.baseSha,
        logsStorageKey: `runs/${runId}.jsonl`,
      });
      const result = await codex.execute(
        assignment,
        prepared.path,
        () => client.heartbeat(runId),
        async (snapshot) => {
          latestLogs = snapshot;
          await client.uploadLogs(runId, snapshot);
        },
        async () => (await client.run(runId)).status,
      );
      latestLogs = result.jsonl;
      summary = result.summary;
      await client.uploadLogs(runId, result.jsonl);
      if (assignment.run.kind === "curation") {
        if (result.curationOutput === undefined) throw new Error("Curation output is missing.");
        await assertActive(runId);
        await client.completeCuration(runId, normalizeCurationOutput(result.curationOutput));
        await recordProvenance(assignment, baseSha, null, "not_applicable");
        await workspaces.cleanup(runId, assignment.project.repositoryPath);
        return;
      }
      headSha = await workspaces.commit(prepared, `aiws: ${assignment.task.title}`);
      await client.advance(runId, { status: "verifying", headSha, summary });
      const results = await verification.execute(
        assignment,
        async () => (await client.run(runId)).status === "cancelled",
      );
      const verificationState = await client.verificationResults(runId, results);
      if (verificationState.status === "failed") {
        await recordProvenance(assignment, baseSha, headSha, "not_attempted");
        return;
      }
      if (verificationState.status === "cancelled") {
        await recordProvenance(assignment, baseSha, headSha, "not_attempted");
        return;
      }
      executionStage = "publishing";
    }
    if (assignment.run.branchName === null) throw new Error("Implementation branch is missing.");
    await assertActive(runId);
    const publishingCredentials = await client.credentials(runId);
    if (assignment.run.executionStage === "publishing") {
      await client.advance(runId, {
        status: "publishing",
        summary,
      });
    }
    if (headSha === null) throw new Error("Publishing checkpoint has no head SHA.");
    await workspaces.push(
      prepared,
      assignment.run.branchName,
      gitAuthentication(publishingCredentials),
      headSha,
    );
    await assertActive(runId);
    const pullRequest = await client.pullRequest(runId, {
      title: assignment.task.title,
      body: `${summary}\n\nAIWS Task: ${assignment.task.id}`,
      head: assignment.run.branchName,
      base:
        assignment.delivery?.baseBranch ??
        assignment.project.defaultBranch ??
        publishingCredentials.defaultBranch,
      draft: true,
    });
    await assertActive(runId);
    await client.complete(runId, {
      prUrl: pullRequest.prUrl,
      headSha,
      summary,
    });
    await recordProvenance(
      assignment,
      baseSha,
      headSha,
      assignment.run.verificationWaiverRunId === null ? "published" : "waived",
    );
    await workspaces.cleanup(checkpointRunId, assignment.project.repositoryPath);
  } catch (error) {
    const errorMessage = safeError(error);
    if (error instanceof CodexExecutionError) latestLogs = error.logs;
    latestLogs = appendRunnerDiagnostic(latestLogs, errorMessage);
    await client.uploadLogs(runId, latestLogs).catch(() => undefined);
    const state = await client.run(runId).catch(() => null);
    if (state?.status !== "cancelled") {
      const errorCode = errorMessage.includes("use a full Retry")
        ? "resume_checkpoint_invalid"
        : "runner_failed";
      await client.fail(runId, { errorCode, errorMessage }).catch(() => undefined);
    }
    const terminal = await client.run(runId).catch(() => null);
    if (terminal !== null && ["failed", "cancelled"].includes(terminal.status)) {
      await recordProvenance(
        assignment,
        terminal.baseSha ?? baseSha,
        terminal.headSha ?? headSha,
        executionStage === "publishing" ? "failed" : "not_attempted",
      );
    }
    if (executionStage === "agent") {
      await workspaces.cleanup(runId, assignment.project.repositoryPath).catch(() => undefined);
    }
  }
}

async function recordProvenance(
  assignment: Assignment,
  baseSha: string | null,
  headSha: string | null,
  publicationOutcome: "not_applicable" | "not_attempted" | "published" | "failed" | "waived",
): Promise<void> {
  const identity = await verification.identity();
  const currentSpecs = assignment.task.specRevisions.filter(
    (spec) => spec.cycleId === assignment.task.currentCycleId,
  );
  const specRevision =
    currentSpecs.length === 0 ? null : Math.max(...currentSpecs.map((spec) => spec.revision));
  const hash = new Bun.CryptoHasher("sha256").update(buildPrompt(assignment)).digest("hex");
  await client
    .recordProvenance(assignment.run.id, {
      aiwsVersion: "0.8.0",
      codexCliVersion: identity.codexCliVersion,
      model: assignment.agentProfile.model,
      reasoningEffort: assignment.agentProfile.reasoningEffort,
      agentImage: config.image,
      agentImageDigest: identity.imageDigest,
      toolchainIdentity: [
        "git",
        "codex",
        ...(assignment.verificationContract?.commands.map((item) => item.executable) ?? []),
      ],
      resourceLimits: { cpus: 2, memory: "4g", pids: 512 },
      networkProfile: config.network,
      baseSha,
      headSha,
      branchName: assignment.run.branchName,
      promptBuilderVersion: PROMPT_BUILDER_VERSION,
      promptHash: hash,
      specRevision,
      attachments: assignment.task.attachments.map((attachment) => ({
        id: attachment.id,
        sha256: attachment.sha256,
      })),
      verificationContractRevision: assignment.run.verificationContractRevision,
      publicationOutcome,
    })
    .catch(() => undefined);
}

function gitAuthentication(credentials: Awaited<ReturnType<AiwsRunnerClient["credentials"]>>) {
  return credentials.kind === "basic"
    ? {
        kind: "basic" as const,
        username: credentials.username,
        password: credentials.password,
      }
    : { kind: "bearer" as const, token: credentials.token };
}

async function assertActive(runId: string): Promise<void> {
  if ((await client.run(runId)).status === "cancelled") throw new Error("Run was cancelled.");
}

async function reconcile(): Promise<void> {
  try {
    const recovered = await client.reconcile(new Date(Date.now() - 5 * 60_000).toISOString());
    for (const run of recovered) await codex.stop(run.id);
  } catch (error) {
    console.error(safeError(error));
  }
}

function required(name: string): string {
  const value = Bun.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
function integer(value: string, minimum: number): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum)
    throw new Error("Runner numeric configuration is invalid.");
  return number;
}
function safeError(error: unknown): string {
  return (error instanceof Error ? `${error.name}: ${error.message}` : "Unknown runner error")
    .replaceAll(/(?:gh[psu]_|sk-)[A-Za-z0-9_-]+/gu, "[REDACTED]")
    .slice(0, 5000);
}
