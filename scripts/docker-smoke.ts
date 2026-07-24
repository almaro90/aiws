import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "aiws-docker-smoke-"));
const repository = join(root, "repos", "example");
const logAttachment = join(repository, "acceptance.log");
const screenshotAttachment = join(repository, "acceptance.png");
const suffix = randomBytes(6).toString("hex");
const image = `aiws-smoke:${suffix}`;
const container = `aiws-smoke-${suffix}`;
const volume = `aiws-smoke-data-${suffix}`;
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const sessionSecret = randomBytes(32).toString("base64");
const runnerControlSecret = randomBytes(32).toString("base64url");
const passwordHash = await Bun.password.hash("docker-smoke-password", { algorithm: "argon2id" });

try {
  await mkdir(repository, { recursive: true });
  await writeFile(logAttachment, "AIWS acceptance log attachment\n");
  await writeFile(
    screenshotAttachment,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await run(["git", "init", repository]);
  await run(["docker", "build", "--network", "host", "--tag", image, "."]);
  await run(["docker", "volume", "create", volume]);
  await run([
    "docker",
    "run",
    "--detach",
    "--name",
    container,
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev",
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--volume",
    `${volume}:/data`,
    "--volume",
    `${join(root, "repos")}:${join(root, "repos")}:ro`,
    "--env",
    "AIWS_ENV=production",
    "--env",
    "AIWS_PUBLIC_URL=https://aiws.local",
    "--env",
    `AIWS_ALLOWED_REPO_ROOTS=["${join(root, "repos")}"]`,
    "--env",
    "AIWS_ADMIN_USERNAME=admin",
    "--env",
    `AIWS_ADMIN_PASSWORD_HASH=${passwordHash}`,
    "--env",
    `AIWS_SESSION_SECRET=${sessionSecret}`,
    "--env",
    `AIWS_API_TOKEN_HASH=sha256:${tokenHash}`,
    "--env",
    "AIWS_RUNNER_CONTROL_URL=http://runner-manager:4318",
    "--env",
    `AIWS_RUNNER_CONTROL_SECRET=${runnerControlSecret}`,
    image,
  ]);

  await waitForHealth();
  const user = (await run(["docker", "inspect", "--format", "{{.Config.User}}", container])).trim();
  if (user === "" || user === "0" || user === "root")
    throw new Error("Container is running as root.");
  if ((await runResult(["docker", "exec", container, "touch", "/rootfs-write-probe"])).code === 0) {
    throw new Error("Container root filesystem is writable.");
  }

  const project = await cli(token, [
    "project",
    "create",
    "--name",
    "Docker smoke",
    "--repository-path",
    repository,
    "--git-provider",
    "other",
    "--account-scope",
    "personal",
  ]);
  const task = await cli(token, [
    "task",
    "create",
    "--project",
    String(project.id),
    "--request",
    "Verify the complete AIWS acceptance workflow.",
    "--attach",
    screenshotAttachment,
    "--attach",
    logAttachment,
  ]);
  assertTask(task, { status: "draft", version: 3, attachmentCount: 2 });
  await verifyAttachmentDownloads(token, task, [screenshotAttachment, logAttachment]);

  const submitted = await transition(token, task, "draft", "curating");
  const blocked = await cli(token, [
    "task",
    "question",
    "create",
    String(task.id),
    "--expected-version",
    String(submitted.version),
    "--type",
    "single-choice",
    "--text",
    "Which environment must be used?",
    "--option",
    "Production",
    "--option",
    "Test",
  ]);
  assertTask(blocked, { status: "blocked", version: 5, questionCount: 1 });
  const question = requireRecord(requireArray(blocked.questions, "questions")[0], "question");
  const option = requireRecord(requireArray(question.options, "question options")[0], "option");
  const answered = await cli(token, [
    "task",
    "question",
    "answer",
    String(task.id),
    String(question.id),
    "--expected-version",
    String(blocked.version),
    "--option-id",
    String(option.id),
  ]);
  assertTask(answered, { status: "curating", version: 6 });

  const specified = await cli(token, [
    "task",
    "update",
    String(task.id),
    "--expected-version",
    String(answered.version),
    "--spec",
    "# Acceptance\nImplement and verify the documented workflow.",
  ]);
  const ready = await transition(token, specified, "curating", "ready");
  const claimArguments = [
    "task",
    "transition",
    String(task.id),
    "--from",
    "ready",
    "--to",
    "implementing",
    "--expected-version",
    String(ready.version),
  ];
  const claims = await Promise.all([
    cliResult(token, claimArguments),
    cliResult(token, claimArguments),
  ]);
  const winners = claims.filter((claim) => claim.code === 0);
  const losers = claims.filter((claim) => claim.code === 5);
  if (winners.length !== 1 || losers.length !== 1) {
    throw new Error(`Concurrent claim produced exit codes ${claims.map((claim) => claim.code)}.`);
  }
  const implementing = JSON.parse(winners[0]?.stdout ?? "") as Record<string, unknown>;
  assertTask(implementing, { status: "implementing", version: 9 });
  const loser = JSON.parse(losers[0]?.stderr ?? "") as Record<string, unknown>;
  if (requireRecord(loser.error, "claim error").code !== "version_conflict") {
    throw new Error("Concurrent claim loser did not report version_conflict.");
  }
  const withPr = await cli(token, [
    "task",
    "update",
    String(task.id),
    "--expected-version",
    String(implementing.version),
    "--pr-url",
    "https://example.com/pull/1",
  ]);
  const done = await transition(token, withPr, "implementing", "done");
  const change = await cli(token, [
    "task",
    "message",
    String(task.id),
    "--expected-version",
    String(done.version),
    "--text",
    "Incremental acceptance change",
  ]);
  if (change.taskVersion !== Number(done.version) + 1) {
    throw new Error("Incremental message did not increment the Task exactly once.");
  }
  const curatingAgain = await cli(token, ["task", "show", String(task.id)]);
  assertTask(curatingAgain, { status: "curating", version: 12 });
  const reopened = await transition(token, curatingAgain, "curating", "ready");
  const archived = await cli(token, [
    "task",
    "archive",
    String(task.id),
    "--expected-version",
    String(reopened.version),
    "--reason",
    "Acceptance workflow complete",
  ]);
  assertTask(archived, { status: "ready", version: 14, archived: true });
  const archivedProject = await cli(token, ["project", "archive", String(project.id)]);
  if (typeof archivedProject.archivedAt !== "string") {
    throw new Error("Project was not archived after its Task.");
  }

  const activity = await cli(token, ["task", "activity", String(task.id), "--limit", "50"]);
  verifyActivity(activity);

  await run(["docker", "restart", container]);
  await waitForHealth();
  const persisted = await cli(token, ["task", "show", String(task.id)]);
  if (
    persisted.status !== "ready" ||
    persisted.version !== archived.version ||
    typeof persisted.archivedAt !== "string"
  ) {
    throw new Error("Task did not survive container restart.");
  }
  const persistedProject = await cli(token, ["project", "show", String(project.id)]);
  if (typeof persistedProject.archivedAt !== "string") {
    throw new Error("Project archive state did not survive container restart.");
  }
  await verifyAttachmentDownloads(token, persisted, [screenshotAttachment, logAttachment]);
  verifyActivity(await cli(token, ["task", "activity", String(task.id), "--limit", "50"]));
  const storedBlobs = (
    await run(["docker", "exec", container, "find", "/data/attachments", "-type", "f"])
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  if (storedBlobs.length !== 2) {
    throw new Error(`Expected two stored blobs, found ${storedBlobs.length}.`);
  }

  console.log(
    "Hito 10 acceptance passed (CLI JSON, questions, concurrency, activity, archives, persistence, files).",
  );
} finally {
  await runResult(["docker", "rm", "--force", container]);
  await runResult(["docker", "volume", "rm", "--force", volume]);
  await runResult(["docker", "image", "rm", "--force", image]);
  await rm(root, { recursive: true, force: true });
}

async function transition(
  apiToken: string,
  task: Record<string, unknown>,
  from: string,
  to: string,
): Promise<Record<string, unknown>> {
  return cli(apiToken, [
    "task",
    "transition",
    String(task.id),
    "--from",
    from,
    "--to",
    to,
    "--expected-version",
    String(task.version),
  ]);
}

async function cli(apiToken: string, args: readonly string[]): Promise<Record<string, unknown>> {
  const result = await cliResult(apiToken, args);
  if (result.code !== 0) {
    throw new Error(`aiws ${args.join(" ")} failed (${result.code}): ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

async function cliResult(
  apiToken: string,
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return runResult([
    "docker",
    "exec",
    container,
    "/app/aiws",
    "--api-url",
    "http://127.0.0.1:3000",
    "--token",
    apiToken,
    "--json",
    ...args,
  ]);
}

async function verifyAttachmentDownloads(
  apiToken: string,
  task: Record<string, unknown>,
  expectedFiles: readonly string[],
): Promise<void> {
  const attachments = requireArray(task.attachments, "attachments").map((item) =>
    requireRecord(item, "attachment"),
  );
  if (attachments.length !== expectedFiles.length) {
    throw new Error(`Expected ${expectedFiles.length} attachments, found ${attachments.length}.`);
  }
  for (const expectedFile of expectedFiles) {
    const name = expectedFile.split("/").at(-1);
    const attachment = attachments.find((item) => item.originalName === name);
    if (attachment === undefined) throw new Error(`Attachment metadata missing for ${name}.`);
    const downloaded = await runBytes([
      "docker",
      "exec",
      container,
      "/app/aiws",
      "--api-url",
      "http://127.0.0.1:3000",
      "--token",
      apiToken,
      "task",
      "attachment",
      "get",
      String(task.id),
      String(attachment.id),
      "--output",
      "-",
    ]);
    if (!Buffer.from(await readFile(expectedFile)).equals(Buffer.from(downloaded))) {
      throw new Error(`Downloaded bytes differ for ${name}.`);
    }
  }
}

function assertTask(
  task: Record<string, unknown>,
  expected: {
    status: string;
    version: number;
    attachmentCount?: number;
    questionCount?: number;
    archived?: boolean;
  },
): void {
  if (task.status !== expected.status || task.version !== expected.version) {
    throw new Error(
      `Expected Task ${expected.status} v${expected.version}, got ${task.status} v${task.version}.`,
    );
  }
  if (
    expected.attachmentCount !== undefined &&
    requireArray(task.attachments, "attachments").length !== expected.attachmentCount
  ) {
    throw new Error("Task attachment count is inconsistent.");
  }
  if (
    expected.questionCount !== undefined &&
    requireArray(task.questions, "questions").length !== expected.questionCount
  ) {
    throw new Error("Task question count is inconsistent.");
  }
  if (expected.archived === true && typeof task.archivedAt !== "string") {
    throw new Error("Task was expected to be archived.");
  }
}

function verifyActivity(page: Record<string, unknown>): void {
  const events = requireArray(page.items, "activity items").map((item) =>
    requireRecord(item, "activity event"),
  );
  const types = events.map((event) => event.type);
  const requiredTypes = [
    "task_created",
    "attachment_added",
    "question_created",
    "question_answered",
    "spec_updated",
    "pr_url_updated",
    "cycle_created",
    "message_created",
    "task_archived",
  ];
  for (const type of requiredTypes) {
    if (!types.includes(type)) throw new Error(`Activity is missing ${type}.`);
  }
  if (types.filter((type) => type === "attachment_added").length !== 2) {
    throw new Error("Activity must contain exactly two attachment_added events.");
  }
  const statusChanges = events
    .filter((event) => event.type === "status_changed")
    .map((event) => requireRecord(event.metadata, "status metadata"));
  const expectedTransitions = [
    ["draft", "curating"],
    ["curating", "blocked"],
    ["blocked", "curating"],
    ["curating", "ready"],
    ["ready", "implementing"],
    ["implementing", "done"],
    ["done", "curating"],
  ];
  for (const [from, to] of expectedTransitions) {
    if (!statusChanges.some((metadata) => metadata.from === from && metadata.to === to)) {
      throw new Error(`Activity is missing status transition ${from} -> ${to}.`);
    }
  }
  if (statusChanges.filter((metadata) => metadata.to === "implementing").length !== 1) {
    throw new Error("Concurrent claim produced an inconsistent number of status events.");
  }
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array.`);
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await runResult([
      "docker",
      "exec",
      container,
      "/app/aiws-server",
      "healthcheck",
    ]);
    if (result.code === 0) return;
    await Bun.sleep(500);
  }
  const logs = await runResult(["docker", "logs", container]);
  throw new Error(`Container did not become healthy: ${logs.stdout}${logs.stderr}`);
}

async function run(command: readonly string[]): Promise<string> {
  const result = await runResult(command);
  if (result.code !== 0) {
    throw new Error(`${command.join(" ")} failed (${result.code}): ${result.stderr}`);
  }
  return result.stdout;
}

async function runBytes(command: readonly string[]): Promise<Uint8Array> {
  const process = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).text(),
  ]);
  if (code !== 0) {
    throw new Error(`${command.join(" ")} failed (${code}): ${stderr}`);
  }
  return new Uint8Array(stdout);
}

async function runResult(
  command: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const process = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { code, stdout, stderr };
}
