import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogAuthMode, CodexModelCatalog } from "./model-catalog.ts";
import { catalogDockerArguments } from "./model-catalog.ts";

export interface ReadinessProfile {
  readonly kind: "curation" | "implementation";
  readonly authMode: CatalogAuthMode;
  readonly credentialReference: string;
  readonly model: string | null;
  readonly reasoningEffort: string | null;
}

export interface RunnerReadinessCheck {
  readonly id: string;
  readonly status: "pass" | "fail" | "skipped";
  readonly message: string;
}

export interface RunnerReadinessDependencies {
  readonly run?: (
    command: readonly string[],
    timeoutMilliseconds: number,
    signal?: AbortSignal,
  ) => Promise<number>;
  readonly workspace?: (directory: string) => Promise<boolean>;
}

export class RunnerReadinessProbe {
  private readonly runCommand: NonNullable<RunnerReadinessDependencies["run"]>;
  private readonly probeWorkspace: NonNullable<RunnerReadinessDependencies["workspace"]>;

  constructor(
    private readonly image: string,
    private readonly network: string,
    private readonly workspacesDirectory: string,
    private readonly catalog: CodexModelCatalog,
    dependencies: RunnerReadinessDependencies = {},
  ) {
    this.runCommand = dependencies.run ?? run;
    this.probeWorkspace = dependencies.workspace ?? writableWorkspace;
  }

  async check(
    profiles: readonly ReadinessProfile[],
    signal?: AbortSignal,
  ): Promise<readonly RunnerReadinessCheck[]> {
    const image = await commandCheck(
      "agent_image",
      ["docker", "image", "inspect", this.image],
      "Agent image is available.",
      "Agent image is unavailable.",
      this.runCommand,
      signal,
    );
    const workspace = (await this.probeWorkspace(this.workspacesDirectory))
      ? passed("workspace", "Workspace storage is writable.")
      : failed("workspace", "Workspace storage is not writable.");
    const network = await commandCheck(
      "network",
      ["docker", "network", "inspect", this.network],
      "Docker network is available.",
      "Docker network is unavailable.",
      this.runCommand,
      signal,
    );
    const container =
      image.status === "pass" && network.status === "pass"
        ? await containerCheck(
            this.image,
            this.network,
            ["true"],
            "container_lifecycle",
            this.runCommand,
            signal,
          )
        : skipped(
            "container_lifecycle",
            "Container lifecycle skipped because prerequisites failed.",
          );
    const toolchain =
      container.status === "pass"
        ? await containerCheck(
            this.image,
            this.network,
            ["sh", "-c", "git --version >/dev/null && codex --version >/dev/null"],
            "toolchain",
            this.runCommand,
            signal,
          )
        : skipped("toolchain", "Toolchain check skipped because the container probe failed.");
    const profileChecks: RunnerReadinessCheck[] = [];
    for (const profile of profiles) profileChecks.push(await profileCheck(this.catalog, profile));
    return [image, workspace, network, container, toolchain, ...profileChecks];
  }
}

async function writableWorkspace(directory: string): Promise<boolean> {
  let temporary: string | null = null;
  try {
    temporary = await mkdtemp(join(directory, "readiness-"));
    await writeFile(join(temporary, "probe"), "ok", { mode: 0o600 });
    return true;
  } catch {
    return false;
  } finally {
    if (temporary !== null) await rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}

async function containerCheck(
  image: string,
  network: string,
  command: readonly string[],
  id: "container_lifecycle" | "toolchain",
  runCommand: NonNullable<RunnerReadinessDependencies["run"]>,
  signal?: AbortSignal,
): Promise<RunnerReadinessCheck> {
  const name = `aiws-readiness-${crypto.randomUUID().replaceAll("-", "")}`;
  const args = catalogDockerArguments(name, network);
  args.push(image, ...command);
  try {
    const exitCode = await runCommand(args, 25_000, signal);
    return exitCode === 0
      ? passed(
          id,
          id === "toolchain"
            ? "Required Git and Codex tools are available."
            : "Ephemeral container lifecycle succeeded.",
        )
      : failed(
          id,
          id === "toolchain"
            ? "Required Git or Codex tool is unavailable."
            : "Ephemeral container lifecycle failed.",
        );
  } catch {
    return failed(
      id,
      id === "toolchain"
        ? "Required Git or Codex tool could not be checked."
        : "Ephemeral container lifecycle could not be completed.",
    );
  } finally {
    await runCommand(["docker", "rm", "-f", name], 10_000).catch(() => undefined);
  }
}

async function profileCheck(
  catalog: CodexModelCatalog,
  profile: ReadinessProfile,
): Promise<RunnerReadinessCheck> {
  const id = `${profile.kind}_model_authentication`;
  try {
    const result = await catalog.list(profile.authMode, profile.credentialReference);
    const model = result.models.find((candidate) => candidate.id === profile.model);
    if (
      model === undefined ||
      profile.reasoningEffort === null ||
      !model.supportedReasoningEfforts.includes(profile.reasoningEffort)
    ) {
      return failed(id, `${label(profile.kind)} model selection is no longer available.`);
    }
    return passed(id, `${label(profile.kind)} model authentication succeeded.`);
  } catch {
    return failed(id, `${label(profile.kind)} model authentication failed.`);
  }
}

async function commandCheck(
  id: string,
  command: readonly string[],
  success: string,
  failure: string,
  runCommand: NonNullable<RunnerReadinessDependencies["run"]>,
  signal?: AbortSignal,
): Promise<RunnerReadinessCheck> {
  try {
    return (await runCommand(command, 15_000, signal)) === 0
      ? passed(id, success)
      : failed(id, failure);
  } catch {
    return failed(id, failure);
  }
}

async function run(
  command: readonly string[],
  timeoutMilliseconds: number,
  signal?: AbortSignal,
): Promise<number> {
  const process = Bun.spawn([...command], {
    stdout: "ignore",
    stderr: "ignore",
    env: { PATH: Bun.env.PATH ?? "/usr/bin:/bin" },
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const exits: Promise<number>[] = [
      process.exited,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          process.kill();
          reject(new Error("Readiness command timed out."));
        }, timeoutMilliseconds);
      }),
    ];
    if (signal !== undefined) {
      exits.push(
        new Promise<never>((_, reject) => {
          abort = () => {
            process.kill();
            reject(new Error("Readiness command was cancelled."));
          };
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        }),
      );
    }
    return await Promise.race(exits);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abort !== undefined) signal?.removeEventListener("abort", abort);
    process.kill();
    await process.exited.catch(() => undefined);
  }
}

function passed(id: string, message: string): RunnerReadinessCheck {
  return { id, status: "pass", message };
}

function failed(id: string, message: string): RunnerReadinessCheck {
  return { id, status: "fail", message };
}

function skipped(id: string, message: string): RunnerReadinessCheck {
  return { id, status: "skipped", message };
}

function label(kind: ReadinessProfile["kind"]): string {
  return kind === "curation" ? "Curation" : "Implementation";
}
