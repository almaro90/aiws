import { afterEach, describe, expect, test } from "bun:test";
import {
  AgentProfileUseCases,
  ConnectionUseCases,
  ProjectUseCases,
  QuestionUseCases,
  RunUseCases,
  SystemClock,
  TaskUseCases,
  UlidIdGenerator,
  VerificationContractUseCases,
} from "@aiws/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, SqliteUnitOfWork } from "../src/index.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function profileSelection() {
  const model = {
    id: "gpt-test",
    name: "GPT Test",
    description: "Fixture model",
    isDefault: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  };
  return {
    model: model.id,
    reasoningEffort: model.defaultReasoningEffort,
    catalog: { models: [model] },
  };
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "aiws-automation-"));
  directories.push(directory);
  const unitOfWork = new SqliteUnitOfWork(openDatabase({ path: join(directory, "aiws.sqlite") }));
  const clock = new SystemClock();
  const ids = new UlidIdGenerator(clock);
  return {
    unitOfWork,
    projects: new ProjectUseCases(unitOfWork, { clock, ids }),
    tasks: new TaskUseCases(unitOfWork, { clock, ids }),
    profiles: new AgentProfileUseCases(unitOfWork, { clock, ids }),
    connections: new ConnectionUseCases(unitOfWork, { clock, ids }),
    runs: new RunUseCases(unitOfWork, { clock, ids }),
    questions: new QuestionUseCases(unitOfWork, { clock, ids }),
    contracts: new VerificationContractUseCases(unitOfWork, { clock, ids }),
  };
}

async function readyAutomatedTask(value: ReturnType<typeof fixture>) {
  const profile = await value.profiles.create({
    name: "Codex",
    authMode: "api_key",
    credentialReference: "CODEX_API_KEY",
    ...profileSelection(),
  });
  const connection = await value.connections.register({
    host: "https://github.com",
    externalAccountId: "42",
    displayName: "acme",
    installationId: "101",
  });
  const project = await value.projects.createManaged({
    name: "Repo",
    repositoryPath: "/repos/repo",
    accountScope: "personal",
    connectionId: connection.id,
    remoteRepositoryId: "101",
    remoteFullName: "acme/repo",
    remoteWebUrl: "https://github.com/acme/repo",
    defaultBranch: "main",
  });
  await value.projects.update(project.id, {
    curationAgentProfileId: profile.id,
    implementationAgentProfileId: profile.id,
    automationEnabled: true,
  });
  let task = await value.tasks.create({
    projectId: project.id,
    userRequest: "Implement the requested change",
    actorType: "web",
  });
  task = await value.tasks.transition({
    taskId: task.id,
    expectedVersion: task.version,
    from: "draft",
    to: "curating",
    actorType: "web",
  });
  task = await value.tasks.update({
    taskId: task.id,
    expectedVersion: task.version,
    changes: { curatorSpec: "Implement and test." },
    actorType: "web",
  });
  task = await value.tasks.transition({
    taskId: task.id,
    expectedVersion: task.version,
    from: "curating",
    to: "ready",
    actorType: "web",
  });
  return task;
}

describe("managed automation persistence", () => {
  test("snapshots the active Verification Contract revision when claiming Implementation", async () => {
    const value = fixture();
    const task = await readyAutomatedTask(value);
    const command = {
      name: "tests",
      executable: "bun",
      args: ["test"],
      required: true,
      timeoutSeconds: 300,
    };
    await value.contracts.replace({
      projectId: task.projectId,
      expectedRevision: null,
      commands: [command],
    });
    const assignment = await value.runs.claimNext();
    if (assignment === null) throw new Error("Implementation was not claimed");
    expect(assignment.run).toMatchObject({
      kind: "implementation",
      verificationContractRevision: 1,
    });
    await value.contracts.replace({
      projectId: task.projectId,
      expectedRevision: 1,
      commands: [{ ...command, name: "lint", args: ["run", "lint"] }],
    });
    expect(await value.runs.get(assignment.run.id)).toMatchObject({
      verificationContractRevision: 1,
    });
    await value.unitOfWork.close();
  });

  test("stores immutable verification evidence, blocks required failure and links a waiver Run", async () => {
    const value = fixture();
    const task = await readyAutomatedTask(value);
    const command = {
      name: "tests",
      executable: "bun",
      args: ["test"],
      required: true,
      timeoutSeconds: 300,
    };
    await value.contracts.replace({
      projectId: task.projectId,
      expectedRevision: null,
      commands: [command],
    });
    const assignment = await value.runs.claimNext();
    if (assignment === null) throw new Error("Implementation was not claimed");
    expect(assignment.verificationContract?.commands).toEqual([command]);
    await value.runs.advance(assignment.run.id, "running", { baseSha: "a".repeat(40) });
    await value.runs.advance(assignment.run.id, "verifying", {
      headSha: "b".repeat(40),
      summary: "Implementation checkpoint.",
    });
    const now = new Date().toISOString();
    const failed = await value.runs.recordVerification(assignment.run.id, [
      {
        position: 0,
        name: "tests",
        executable: "bun",
        args: ["test"],
        required: true,
        status: "failed",
        startedAt: now,
        finishedAt: now,
        durationMs: 12,
        exitCode: 1,
        stdoutExcerpt: "",
        stderrExcerpt: "one test failed",
        imageDigest: "sha256:fixture",
        toolchainIdentity: "sha256:fixture:bun",
      },
    ]);
    expect(failed).toMatchObject({
      status: "failed",
      errorCode: "verification_failed",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
    });
    expect(await value.runs.verificationResults(failed.id)).toHaveLength(1);
    await expect(value.runs.recordVerification(failed.id, [])).rejects.toThrow();
    const ready = await value.tasks.get(task.id);
    expect(ready).toMatchObject({ status: "ready", automationPaused: true });
    const waiver = await value.runs.waiveVerification(
      failed.id,
      ready.version,
      "External dependency is unavailable; reviewer accepted the risk.",
    );
    expect(waiver.run).toMatchObject({
      executionStage: "publishing",
      resumeFromRunId: failed.id,
      verificationWaiverRunId: failed.id,
      verificationWaiverReason: "External dependency is unavailable; reviewer accepted the risk.",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
    });
    expect((await value.runs.get(failed.id)).status).toBe("failed");
    await value.unitOfWork.close();
  });

  test("advances after optional verification failure and closes provenance once", async () => {
    const value = fixture();
    const task = await readyAutomatedTask(value);
    await value.contracts.replace({
      projectId: task.projectId,
      expectedRevision: null,
      commands: [
        {
          name: "e2e",
          executable: "bun",
          args: ["run", "test:e2e"],
          required: false,
          timeoutSeconds: 300,
        },
      ],
    });
    const assignment = await value.runs.claimNext();
    if (assignment === null) throw new Error("Implementation was not claimed");
    await value.runs.advance(assignment.run.id, "running", { baseSha: "a".repeat(40) });
    await value.runs.advance(assignment.run.id, "verifying", { headSha: "b".repeat(40) });
    const now = new Date().toISOString();
    const publishing = await value.runs.recordVerification(assignment.run.id, [
      {
        position: 0,
        name: "e2e",
        executable: "bun",
        args: ["run", "test:e2e"],
        required: false,
        status: "timed_out",
        startedAt: now,
        finishedAt: now,
        durationMs: 300_000,
        exitCode: null,
        stdoutExcerpt: "",
        stderrExcerpt: "timeout",
        imageDigest: "sha256:fixture",
        toolchainIdentity: "sha256:fixture:bun",
      },
    ]);
    expect(publishing.status).toBe("publishing");
    await value.runs.complete(assignment.run.id, {
      prUrl: "https://github.com/acme/repo/pull/verification",
      headSha: "b".repeat(40),
      summary: "Published with optional warning.",
    });
    const provenance = await value.runs.recordProvenance(assignment.run.id, {
      aiwsVersion: "0.8.0",
      codexCliVersion: "codex 1",
      model: "gpt-test",
      reasoningEffort: "medium",
      agentImage: "aiws-agent:0.8.0",
      agentImageDigest: "sha256:fixture",
      toolchainIdentity: ["bun"],
      resourceLimits: { cpus: 2 },
      networkProfile: "default",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      branchName: assignment.run.branchName,
      promptBuilderVersion: "1",
      promptHash: "c".repeat(64),
      specRevision: null,
      attachments: [],
      verificationContractRevision: 1,
      publicationOutcome: "published",
    });
    expect(await value.runs.provenance(assignment.run.id)).toEqual(provenance);
    await expect(
      value.runs.recordProvenance(assignment.run.id, {
        ...provenance,
      }),
    ).rejects.toThrow();
    await value.unitOfWork.close();
  });

  test("requires an enabled Agent Profile before managed curation", async () => {
    const value = fixture();
    const connection = await value.connections.register({
      host: "https://github.com",
      externalAccountId: "6",
      displayName: "acme",
      installationId: "6",
    });
    const project = await value.projects.createManaged({
      name: "Unconfigured managed",
      repositoryPath: "/repos/unconfigured",
      accountScope: "work",
      connectionId: connection.id,
      remoteRepositoryId: "6",
      remoteFullName: "acme/unconfigured",
      remoteWebUrl: "https://github.com/acme/unconfigured",
      defaultBranch: "main",
    });
    const task = await value.tasks.create({
      projectId: project.id,
      userRequest: "Curate this",
      actorType: "web",
    });
    await expect(
      value.tasks.transition({
        taskId: task.id,
        expectedVersion: task.version,
        from: "draft",
        to: "curating",
        actorType: "web",
      }),
    ).rejects.toThrow("requires a Curation Agent Profile");
    expect(await value.tasks.get(task.id)).toMatchObject({ status: "draft", version: 1 });

    const profile = await value.profiles.create({
      name: "Disabled curator",
      authMode: "api_key",
      credentialReference: "CODEX_API_KEY",
      ...profileSelection(),
    });
    await value.projects.update(project.id, { curationAgentProfileId: profile.id });
    await value.profiles.setEnabled(profile.id, false);
    await expect(
      value.tasks.transition({
        taskId: task.id,
        expectedVersion: task.version,
        from: "draft",
        to: "curating",
        actorType: "web",
      }),
    ).rejects.toThrow("requires an enabled Curation Agent Profile");
    await value.unitOfWork.close();
  });

  test("runs the managed flow from Draft through re-curation to Done", async () => {
    const value = fixture();
    const profile = await value.profiles.create({
      name: "Curator",
      authMode: "api_key",
      credentialReference: "CODEX_API_KEY",
      ...profileSelection(),
    });
    const connection = await value.connections.register({
      host: "https://github.com",
      externalAccountId: "7",
      displayName: "acme",
      installationId: "7",
    });
    const project = await value.projects.createManaged({
      name: "Managed",
      repositoryPath: "/repos/managed",
      accountScope: "work",
      connectionId: connection.id,
      remoteRepositoryId: "7",
      remoteFullName: "acme/managed",
      remoteWebUrl: "https://github.com/acme/managed",
      defaultBranch: "main",
    });
    await value.projects.update(project.id, { curationAgentProfileId: profile.id });
    let task = await value.tasks.create({
      projectId: project.id,
      userRequest: "Initial request",
      actorType: "web",
    });
    task = await value.tasks.update({
      taskId: task.id,
      expectedVersion: task.version,
      changes: { userRequest: "Final request before submission" },
      actorType: "web",
    });
    task = await value.tasks.transition({
      taskId: task.id,
      expectedVersion: task.version,
      from: "draft",
      to: "curating",
      actorType: "web",
    });
    const claims = await Promise.all([value.runs.claimNext(), value.runs.claimNext()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find((claim) => claim !== null);
    if (first === undefined || first === null) throw new Error("Curation was not claimed");
    expect(first.run).toMatchObject({
      kind: "curation",
      agentProfileId: profile.id,
      attempt: 1,
      branchName: null,
    });
    await value.runs.advance(first.run.id, "running", { baseSha: "a".repeat(40) });
    const blockedRun = await value.runs.completeCuration(first.run.id, {
      outcome: "blocked",
      title: "Refined title",
      curatorSpec: "# Partial context",
      questions: [
        { text: "Which mode?", type: "text", options: [], allowOther: false },
        {
          text: "Which target?",
          type: "single_choice",
          options: [{ label: "A" }, { label: "B" }],
          allowOther: false,
        },
      ],
      summary: "Product decisions required.",
    });
    expect(blockedRun).toMatchObject({ status: "succeeded", outcome: "blocked" });
    let blocked = await value.tasks.get(task.id);
    expect(blocked).toMatchObject({
      status: "blocked",
      title: "Refined title",
      version: first.task.version + 1,
    });
    expect(blocked.questions).toHaveLength(2);
    const modeQuestion = blocked.questions[0];
    const targetQuestion = blocked.questions[1];
    const targetOption = targetQuestion?.options[0];
    if (modeQuestion === undefined || targetQuestion === undefined || targetOption === undefined) {
      throw new Error("Curation Questions were not materialized");
    }
    blocked = await value.questions.answer({
      taskId: task.id,
      questionId: modeQuestion.id,
      expectedVersion: blocked.version,
      selectedOptionIds: [],
      answerText: "Use the existing mode.",
      actorType: "web",
    });
    blocked = await value.questions.answer({
      taskId: task.id,
      questionId: targetQuestion.id,
      expectedVersion: blocked.version,
      selectedOptionIds: [targetOption.id],
      answerText: null,
      actorType: "web",
    });
    expect(blocked.status).toBe("curating");
    const second = await value.runs.claimNext();
    if (second === null) throw new Error("Re-curation was not claimed");
    expect(second.run).toMatchObject({ kind: "curation", attempt: 2 });
    await value.runs.advance(second.run.id, "running", { baseSha: "b".repeat(40) });
    await value.runs.completeCuration(second.run.id, {
      outcome: "ready",
      curatorSpec: "# Objective\nImplement the selected behavior.\n# Acceptance\nTests pass.",
      summary: "Specification ready.",
    });
    const ready = await value.tasks.get(task.id);
    expect(ready).toMatchObject({
      status: "ready",
      automationPaused: false,
    });
    const implementationProfile = await value.profiles.create({
      name: "Implementer",
      authMode: "api_key",
      credentialReference: "IMPLEMENTATION_API_KEY",
      ...profileSelection(),
    });
    await value.projects.update(project.id, {
      implementationAgentProfileId: implementationProfile.id,
      automationEnabled: true,
    });
    const implementation = await value.runs.claimNext();
    if (implementation === null) throw new Error("Implementation was not claimed");
    expect(implementation.run).toMatchObject({
      kind: "implementation",
      agentProfileId: implementationProfile.id,
      attempt: 1,
      taskVersion: ready.version + 1,
    });
    await value.runs.advance(implementation.run.id, "running", { baseSha: "c".repeat(40) });
    await value.runs.advance(implementation.run.id, "publishing", { headSha: "d".repeat(40) });
    await value.runs.complete(implementation.run.id, {
      prUrl: "https://github.com/acme/managed/pull/1",
      headSha: "d".repeat(40),
      summary: "Implemented and verified.",
    });
    expect(await value.tasks.get(task.id)).toMatchObject({
      status: "done",
      prUrl: "https://github.com/acme/managed/pull/1",
      automationPaused: false,
    });
    await value.unitOfWork.close();
  });

  test("snapshots manual Ready approval and excludes prepared Tasks from curation claims", async () => {
    const value = fixture();
    const profile = await value.profiles.create({
      name: "Approval curator",
      authMode: "api_key",
      credentialReference: "APPROVAL_API_KEY",
      ...profileSelection(),
    });
    const connection = await value.connections.register({
      host: "https://github.com",
      externalAccountId: "approval",
      displayName: "acme",
      installationId: "approval",
    });
    const project = await value.projects.createManaged({
      name: "Approval",
      repositoryPath: "/repos/approval",
      accountScope: "work",
      connectionId: connection.id,
      remoteRepositoryId: "approval",
      remoteFullName: "acme/approval",
      remoteWebUrl: "https://github.com/acme/approval",
      defaultBranch: "main",
    });
    await value.projects.update(project.id, {
      curationAgentProfileId: profile.id,
      readyPolicy: "manual_approval_required",
    });
    let task = await value.tasks.create({
      projectId: project.id,
      userRequest: "Prepare approval",
      actorType: "web",
    });
    task = await value.tasks.transition({
      taskId: task.id,
      expectedVersion: task.version,
      from: "draft",
      to: "curating",
      actorType: "web",
    });
    const assignment = await value.runs.claimNext();
    if (assignment === null) throw new Error("Curation was not claimed");
    expect(assignment.run.readyPolicy).toBe("manual_approval_required");
    await value.projects.update(project.id, { readyPolicy: "curator_decides" });
    await value.runs.advance(assignment.run.id, "running");
    const completed = await value.runs.completeCuration(assignment.run.id, {
      outcome: "ready",
      curatorSpec: "# Prepared",
      summary: "Ready for explicit approval.",
    });
    expect(completed).toMatchObject({
      status: "succeeded",
      outcome: "approval_required",
      readyPolicy: "manual_approval_required",
    });
    const prepared = await value.tasks.get(task.id);
    expect(prepared).toMatchObject({
      status: "curating",
      readyApprovalPending: true,
      version: assignment.task.version + 1,
    });
    expect(await value.runs.claimNext()).toBeNull();

    const approvals = await Promise.allSettled([
      value.tasks.transition({
        taskId: task.id,
        expectedVersion: prepared.version,
        from: "curating",
        to: "ready",
        actorType: "web",
      }),
      value.tasks.transition({
        taskId: task.id,
        expectedVersion: prepared.version,
        from: "curating",
        to: "ready",
        actorType: "cli",
      }),
    ]);
    expect(approvals.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await value.tasks.get(task.id)).toMatchObject({
      status: "ready",
      readyApprovalPending: false,
      version: prepared.version + 1,
    });
    await value.unitOfWork.close();
  });

  test("discards a stale curation result, pauses on failure and retries by kind", async () => {
    const value = fixture();
    const ready = await readyAutomatedTask(value);
    // A separate managed Task exercises a curation version conflict.
    const project = ready.project;
    let task = await value.tasks.create({
      projectId: project.id,
      userRequest: "Curate me",
      actorType: "web",
    });
    task = await value.tasks.transition({
      taskId: task.id,
      expectedVersion: task.version,
      from: "draft",
      to: "curating",
      actorType: "web",
    });
    const assignment = await value.runs.claimNext();
    if (assignment === null || assignment.run.kind !== "curation")
      throw new Error("Curation was not claimed");
    await value.runs.advance(assignment.run.id, "running");
    const changed = await value.tasks.update({
      taskId: task.id,
      expectedVersion: assignment.task.version,
      changes: { curatorSpec: "Concurrent context" },
      actorType: "cli",
    });
    await expect(
      value.runs.completeCuration(assignment.run.id, {
        outcome: "ready",
        curatorSpec: "Stale spec",
        summary: "stale",
      }),
    ).rejects.toThrow();
    expect(await value.tasks.get(task.id)).toMatchObject({
      version: changed.version,
      curatorSpec: "Concurrent context",
      status: "curating",
    });
    const failed = await value.runs.fail(assignment.run.id, {
      errorCode: "version_conflict",
      errorMessage: "Task changed",
    });
    const paused = await value.tasks.get(task.id);
    expect(paused).toMatchObject({
      status: "curating",
      automationPaused: true,
      version: changed.version + 1,
    });
    const retried = await value.runs.retry(failed.id, paused.version);
    expect(retried.run).toMatchObject({ kind: "curation", attempt: 2, branchName: null });
    expect(retried.task).toMatchObject({ status: "curating", automationPaused: false });
    await value.unitOfWork.close();
  });

  test("registers Connections idempotently and persists Agent Profiles", async () => {
    const value = fixture();
    const input = {
      host: "https://github.com",
      externalAccountId: "42",
      displayName: "octocat",
      installationId: "100",
    };
    const first = await value.connections.register(input);
    const second = await value.connections.register(input);
    expect(second.id).toBe(first.id);
    expect(await value.connections.list()).toHaveLength(1);
    const profile = await value.profiles.create({
      name: "Codex",
      authMode: "chatgpt_session",
      credentialReference: "CODEX_ACCESS_TOKEN",
      ...profileSelection(),
    });
    expect((await value.profiles.get(profile.id)).authMode).toBe("chatgpt_session");
    await value.unitOfWork.close();
  });

  test("claims once and completes Task with one version increment", async () => {
    const value = fixture();
    const task = await readyAutomatedTask(value);
    const assignment = await value.runs.claimNext();
    expect(assignment?.task).toMatchObject({ status: "implementing", version: task.version + 1 });
    expect(await value.runs.claimNext()).toBeNull();
    if (assignment === null) throw new Error("Run was not claimed");
    const runId = assignment.run.id;
    expect(assignment.run.status).toBe("preparing");
    await value.runs.advance(runId, "running", { baseSha: "a".repeat(40) });
    await value.runs.advance(runId, "publishing", { headSha: "b".repeat(40) });
    const completed = await value.runs.complete(runId, {
      prUrl: "https://github.com/acme/repo/pull/1",
      headSha: "b".repeat(40),
      summary: "Implemented and tested.",
    });
    expect(completed.status).toBe("succeeded");
    expect(await value.tasks.get(task.id)).toMatchObject({
      status: "done",
      prUrl: "https://github.com/acme/repo/pull/1",
      version: task.version + 2,
    });
    await value.unitOfWork.close();
  });

  test("failure returns Task to Ready and pauses automatic dispatch until retry", async () => {
    const value = fixture();
    const task = await readyAutomatedTask(value);
    const assignment = await value.runs.claimNext();
    if (assignment === null) throw new Error("Run was not claimed");
    const failed = await value.runs.fail(assignment.run.id, {
      errorCode: "agent_failed",
      errorMessage: "Codex exited non-zero.",
    });
    expect(failed.status).toBe("failed");
    const ready = await value.tasks.get(task.id);
    expect(ready).toMatchObject({ status: "ready", automationPaused: true });
    expect(await value.runs.claimNext()).toBeNull();
    const retried = await value.runs.retry(failed.id, ready.version);
    expect(retried.run.attempt).toBe(2);
    expect(retried.task).toMatchObject({ status: "implementing", automationPaused: false });
    const resumed = await value.runs.claimNext();
    expect(resumed?.run).toMatchObject({ id: retried.run.id, attempt: 2, status: "preparing" });
    expect(await value.runs.claimNext()).toBeNull();
    await value.unitOfWork.close();
  });

  test("retry snapshots the current profile for the Run kind", async () => {
    const value = fixture();
    const task = await readyAutomatedTask(value);
    const assignment = await value.runs.claimNext();
    if (assignment === null) throw new Error("Run was not claimed");
    const failed = await value.runs.fail(assignment.run.id, {
      errorCode: "agent_failed",
      errorMessage: "Codex exited non-zero.",
    });
    const replacement = await value.profiles.create({
      name: "Replacement implementer",
      authMode: "api_key",
      credentialReference: "REPLACEMENT_API_KEY",
      ...profileSelection(),
    });
    await value.projects.update(task.project.id, {
      implementationAgentProfileId: replacement.id,
    });
    const ready = await value.tasks.get(task.id);
    const retried = await value.runs.retry(failed.id, ready.version);
    expect(retried.run.agentProfileId).toBe(replacement.id);
    expect((await value.runs.get(assignment.run.id)).agentProfileId).toBe(
      assignment.run.agentProfileId,
    );
    const future = await value.profiles.create({
      name: "Future implementer",
      authMode: "api_key",
      credentialReference: "FUTURE_API_KEY",
      ...profileSelection(),
    });
    await value.projects.update(task.project.id, {
      implementationAgentProfileId: future.id,
    });
    expect((await value.runs.claimNext())?.run.agentProfileId).toBe(replacement.id);
    await value.unitOfWork.close();
  });

  test("manual resume clears a pause and allows a fresh Run to be claimed", async () => {
    const value = fixture();
    const task = await readyAutomatedTask(value);
    const assignment = await value.runs.claimNext();
    if (assignment === null) throw new Error("Run was not claimed");
    await value.runs.fail(assignment.run.id, {
      errorCode: "agent_failed",
      errorMessage: "Codex exited non-zero.",
    });
    const paused = await value.tasks.get(task.id);
    const resumed = await value.tasks.resumeAutomation({
      taskId: task.id,
      expectedVersion: paused.version,
      actorType: "web",
    });
    expect(resumed).toMatchObject({
      status: "ready",
      automationPaused: false,
      version: paused.version + 1,
    });
    expect((await value.runs.claimNext())?.run).toMatchObject({
      kind: "implementation",
      attempt: 2,
      status: "preparing",
    });
    await value.unitOfWork.close();
  });

  test("auto Retry resumes a publishing checkpoint and full Retry restarts the agent", async () => {
    const value = fixture();
    const task = await readyAutomatedTask(value);
    const assignment = await value.runs.claimNext();
    if (assignment === null) throw new Error("Run was not claimed");
    await value.runs.advance(assignment.run.id, "running", { baseSha: "a".repeat(40) });
    await value.runs.advance(assignment.run.id, "publishing", {
      headSha: "b".repeat(40),
      summary: "Agent completed once.",
    });
    const failed = await value.runs.fail(assignment.run.id, {
      errorCode: "runner_failed",
      errorMessage: "Git command failed: credential expired",
    });
    const ready = await value.tasks.get(task.id);
    const resumed = await value.runs.retry(failed.id, ready.version, "auto");
    expect(resumed.run).toMatchObject({
      executionStage: "publishing",
      resumeFromRunId: failed.id,
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      summary: "Agent completed once.",
    });
    const cancelled = await value.runs.cancel(
      resumed.run.id,
      "Choose a full Retry.",
      resumed.task.version,
    );
    const readyAgain = await value.tasks.get(task.id);
    const restarted = await value.runs.retry(cancelled.id, readyAgain.version, "full");
    expect(restarted.run).toMatchObject({
      executionStage: "agent",
      resumeFromRunId: null,
      baseSha: null,
    });
    await value.unitOfWork.close();
  });

  test("publishing recovery completes attempt 2 and leaves the Task Done", async () => {
    const value = fixture();
    const task = await readyAutomatedTask(value);
    const first = await value.runs.claimNext();
    if (first === null) throw new Error("Run was not claimed");
    await value.runs.advance(first.run.id, "running", { baseSha: "a".repeat(40) });
    await value.runs.advance(first.run.id, "publishing", {
      headSha: "b".repeat(40),
      summary: "Agent completed once.",
    });
    const failed = await value.runs.fail(first.run.id, {
      errorCode: "runner_failed",
      errorMessage: "Pull request publishing failed",
    });
    const ready = await value.tasks.get(task.id);
    const recovered = await value.runs.retry(failed.id, ready.version, "auto");
    expect(recovered.run).toMatchObject({
      attempt: 2,
      status: "queued",
      executionStage: "publishing",
      resumeFromRunId: failed.id,
    });
    await value.runs.advance(recovered.run.id, "preparing");
    await value.runs.advance(recovered.run.id, "running", { baseSha: "a".repeat(40) });
    await value.runs.advance(recovered.run.id, "publishing", {
      summary: "Recovered publishing.",
    });
    await value.runs.complete(recovered.run.id, {
      prUrl: "https://github.com/acme/repo/pull/2",
      headSha: "b".repeat(40),
      summary: "Recovered publishing.",
    });
    expect(await value.tasks.get(task.id)).toMatchObject({
      status: "done",
      prUrl: "https://github.com/acme/repo/pull/2",
    });
    await value.unitOfWork.close();
  });

  test("reconciles stale active Runs after a runner restart", async () => {
    const value = fixture();
    const task = await readyAutomatedTask(value);
    const assignment = await value.runs.claimNext();
    if (assignment === null) throw new Error("Run was not claimed");
    const recovered = await value.runs.reconcileStale("9999-12-31T23:59:59.999Z");
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ status: "failed", errorCode: "runner_heartbeat_timeout" });
    expect(await value.tasks.get(task.id)).toMatchObject({
      status: "ready",
      automationPaused: true,
    });
    await value.unitOfWork.close();
  });
});
