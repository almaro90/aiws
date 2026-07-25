import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "aiws-distribution-smoke-"));
const repository = join(root, "repos", "example");
const suffix = randomBytes(5).toString("hex");
const namespace = `aiws-local-${suffix}`;
const project = `aiws-dist-${suffix}`;
const port = 38_000 + Math.floor(Math.random() * 1_000);
const token = randomBytes(32).toString("base64url");
const runnerToken = randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const passwordHash = await Bun.password.hash("distribution-smoke-password", {
  algorithm: "argon2id",
});
const composeEnvironment = {
  ...process.env,
  AIWS_VERSION: "0.6.0",
  AIWS_IMAGE_NAMESPACE: namespace,
  AIWS_PORT: String(port),
  AIWS_ENV_FILE: join(root, ".env"),
  AIWS_REPO_ROOT: join(root, "repos"),
  AIWS_DOCKER_NETWORK: `${project}-runtime`,
  AIWS_REPOSITORIES_VOLUME: `${project}-repositories`,
  AIWS_WORKSPACES_VOLUME: `${project}-workspaces`,
  AIWS_CODEX_AUTH_VOLUME: `${project}-codex-auth`,
};
const compose = [
  "docker",
  "compose",
  "--env-file",
  join(root, ".env"),
  "--project-directory",
  root,
  "-p",
  project,
  "-f",
  join(root, "compose.yaml"),
];

try {
  await mkdir(repository, { recursive: true });
  await run(["git", "init", repository]);
  await Promise.all([
    run(["docker", "build", "--target", "server", "-t", `${namespace}/aiws:0.6.0`, "."]),
    run([
      "docker",
      "build",
      "--target",
      "runner-manager",
      "-t",
      `${namespace}/aiws-runner-manager:0.6.0`,
      ".",
    ]),
    run(["docker", "build", "--target", "agent", "-t", `${namespace}/aiws-agent:0.6.0`, "."]),
  ]);

  await Bun.write(join(root, "compose.yaml"), await Bun.file("distribution/compose.yaml").text());
  await Bun.write(
    join(root, ".env"),
    [
      "AIWS_VERSION=0.6.0",
      `AIWS_IMAGE_NAMESPACE=${namespace}`,
      "AIWS_ENV=production",
      "AIWS_PUBLIC_URL=https://aiws.local",
      `AIWS_ALLOWED_REPO_ROOTS=${JSON.stringify([join(root, "repos")])}`,
      "AIWS_ADMIN_USERNAME=admin",
      `AIWS_ADMIN_PASSWORD_HASH='${passwordHash}'`,
      `AIWS_SESSION_SECRET=${randomBytes(32).toString("base64")}`,
      `AIWS_NOTIFICATION_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
      `AIWS_API_TOKEN_HASH=sha256:${hash(token)}`,
      `AIWS_RUNNER_TOKEN=${runnerToken}`,
      `AIWS_RUNNER_TOKEN_HASH=sha256:${hash(runnerToken)}`,
      `AIWS_RUNNER_CONTROL_SECRET=${randomBytes(32).toString("base64url")}`,
      `AIWS_REPO_ROOT=${join(root, "repos")}`,
      `AIWS_PORT=${port}`,
      `AIWS_DOCKER_NETWORK=${project}-runtime`,
      `AIWS_REPOSITORIES_VOLUME=${project}-repositories`,
      `AIWS_WORKSPACES_VOLUME=${project}-workspaces`,
      `AIWS_CODEX_AUTH_VOLUME=${project}-codex-auth`,
      "",
    ].join("\n"),
  );

  await run([...compose, "up", "-d"], composeEnvironment);
  const serverContainer = (
    await run([...compose, "ps", "--quiet", "aiws"], composeEnvironment)
  ).trim();
  if (serverContainer === "") throw new Error("Bundled AIWS container was not created.");
  await waitForHealth(serverContainer);
  await waitForRunner(serverContainer, token);

  const createdProject = await cli(serverContainer, token, [
    "project",
    "create",
    "--name",
    "Distribution smoke",
    "--repository-path",
    repository,
    "--git-provider",
    "other",
    "--account-scope",
    "personal",
  ]);
  const task = await cli(serverContainer, token, [
    "task",
    "create",
    "--project",
    String(createdProject.id),
    "--request",
    "Verify the release bundle from an empty directory.",
  ]);

  await run([...compose, "restart", "aiws"], composeEnvironment);
  await waitForHealth(serverContainer);
  const persisted = await cli(serverContainer, token, ["task", "show", String(task.id)]);
  if (persisted.id !== task.id || persisted.version !== 1) {
    throw new Error("Task did not persist after restarting the bundled stack.");
  }

  console.log("Distribution bundle smoke passed (health, runner, migrations and persistence).");
} catch (error) {
  const logs = await runResult([...compose, "logs", "--no-color"], composeEnvironment);
  if (logs.stdout !== "") console.error(logs.stdout);
  if (logs.stderr !== "") console.error(logs.stderr);
  throw error;
} finally {
  await runResult([...compose, "down", "--volumes", "--remove-orphans"], composeEnvironment);
  for (const image of ["aiws", "aiws-runner-manager", "aiws-agent"]) {
    await runResult(["docker", "image", "rm", "--force", `${namespace}/${image}:0.6.0`]);
  }
  await rm(root, { recursive: true, force: true });
}

async function cli(
  container: string,
  apiToken: string,
  arguments_: string[],
): Promise<Record<string, unknown>> {
  const result = await runResult([
    "docker",
    "exec",
    "--env",
    `AIWS_API_TOKEN=${apiToken}`,
    container,
    "/app/aiws",
    "--api-url",
    "http://127.0.0.1:3000",
    "--json",
    ...arguments_,
  ]);
  if (result.code !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

async function waitForHealth(container: string): Promise<void> {
  let lastError = "no response";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await runResult([
      "docker",
      "exec",
      container,
      "/app/aiws-server",
      "healthcheck",
    ]);
    if (result.code === 0) return;
    lastError = result.stderr;
    await Bun.sleep(500);
  }
  throw new Error(`Bundled AIWS did not become healthy: ${lastError}`);
}

async function waitForRunner(container: string, apiToken: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await cli(container, apiToken, ["runner", "status"]);
    if (status.status === "online") return;
    await Bun.sleep(500);
  }
  throw new Error("Bundled runner-manager did not report online.");
}

async function run(
  command: string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string> {
  const result = await runResult(command, environment);
  if (result.code !== 0) throw new Error(`${command[0]} failed: ${result.stderr}`);
  return result.stdout;
}

async function runResult(
  command: string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", env: environment });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}
