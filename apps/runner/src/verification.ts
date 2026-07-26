import type { Assignment } from "./client.ts";

const OUTPUT_LIMIT = 16_384;

export interface VerificationRuntimeIdentity {
  readonly imageDigest: string;
  readonly codexCliVersion: string | null;
}

export class VerificationRuntime {
  constructor(
    private readonly image: string,
    private readonly network: string,
    private readonly workspacesVolume: string,
  ) {}

  async identity(): Promise<VerificationRuntimeIdentity> {
    const inspect = Bun.spawn(["docker", "image", "inspect", "--format={{.Id}}", this.image], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const imageDigest =
      (await inspect.exited) === 0
        ? (await new Response(inspect.stdout).text()).trim()
        : `unresolved:${this.image}`;
    const version = Bun.spawn(
      ["docker", "run", "--rm", "--network", "none", this.image, "codex", "--version"],
      {
        stdout: "pipe",
        stderr: "ignore",
      },
    );
    const codexCliVersion =
      (await version.exited) === 0
        ? (await new Response(version.stdout).text()).trim().slice(0, 120)
        : null;
    return { imageDigest, codexCliVersion };
  }

  async execute(
    assignment: Assignment,
    isCancelled: () => Promise<boolean>,
  ): Promise<readonly Record<string, unknown>[]> {
    const identity = await this.identity();
    const commands = assignment.verificationContract?.commands ?? [];
    const results: Record<string, unknown>[] = [];
    for (const [position, command] of commands.entries()) {
      const started = new Date();
      const containerName = `aiws-verify-${assignment.run.id}-${position}`;
      let status: "passed" | "failed" | "timed_out" | "spawn_error" | "cancelled" = "spawn_error";
      let exitCode: number | null = null;
      let stdoutExcerpt = "";
      let stderrExcerpt = "";
      try {
        if (await isCancelled()) {
          status = "cancelled";
        } else {
          const process = Bun.spawn(
            [
              "docker",
              "run",
              "--rm",
              "--name",
              containerName,
              "--network",
              this.network,
              "--cpus",
              "2",
              "--memory",
              "4g",
              "--pids-limit",
              "512",
              "--read-only",
              "--tmpfs",
              "/tmp:rw,noexec,nosuid,nodev",
              "--cap-drop",
              "ALL",
              "--security-opt",
              "no-new-privileges:true",
              "--mount",
              `type=volume,src=${this.workspacesVolume},dst=/workspace,volume-subpath=runs/${assignment.run.id}/repository`,
              "--workdir",
              "/workspace",
              this.image,
              command.executable,
              ...command.args,
            ],
            { stdout: "pipe", stderr: "pipe", env: { PATH: Bun.env.PATH ?? "/usr/bin:/bin" } },
          );
          let timedOut = false;
          const timeout = setTimeout(() => {
            timedOut = true;
            void stopContainer(containerName);
          }, command.timeoutSeconds * 1_000);
          const [stdout, stderr, code] = await Promise.all([
            new Response(process.stdout).text(),
            new Response(process.stderr).text(),
            process.exited,
          ]);
          clearTimeout(timeout);
          stdoutExcerpt = excerpt(stdout);
          stderrExcerpt = excerpt(stderr);
          exitCode = code;
          if (timedOut) status = "timed_out";
          else status = code === 0 ? "passed" : "failed";
          if (await isCancelled()) status = "cancelled";
        }
      } catch (error) {
        stderrExcerpt = excerpt(
          error instanceof Error ? error.message : "Verification spawn failed.",
        );
      }
      const finished = new Date();
      results.push({
        position,
        name: command.name,
        executable: command.executable,
        args: command.args,
        required: command.required,
        status,
        startedAt: started.toISOString(),
        finishedAt: finished.toISOString(),
        durationMs: Math.max(0, finished.getTime() - started.getTime()),
        exitCode,
        stdoutExcerpt,
        stderrExcerpt,
        imageDigest: identity.imageDigest,
        toolchainIdentity: `${identity.imageDigest}:${command.executable}`.slice(0, 1_024),
      });
    }
    return results;
  }
}

async function stopContainer(name: string): Promise<void> {
  const process = Bun.spawn(["docker", "stop", "--time", "1", name], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await process.exited;
}

function excerpt(value: string): string {
  const redacted = value
    .replaceAll(/(?:gh[psu]_|sk-)[A-Za-z0-9_-]+/gu, "[REDACTED]")
    .replaceAll(/(password|token|secret|authorization)=\\?["']?[^\s"'\\]+/giu, "$1=[REDACTED]");
  if (redacted.length <= OUTPUT_LIMIT) return redacted;
  const half = Math.floor((OUTPUT_LIMIT - 32) / 2);
  return `${redacted.slice(0, half)}\n...[output truncated]...\n${redacted.slice(-half)}`;
}
