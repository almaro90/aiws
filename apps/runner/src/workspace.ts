import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";

export interface PreparedWorkspace {
  readonly path: string;
  readonly baseSha: string;
}

export class GitWorkspaceManager {
  constructor(private readonly workspacesRoot: string) {}

  async prepare(
    runId: string,
    mirrorPath: string,
    cloneUrl: string,
    token: string,
    fallbackRef: string,
    branchName: string | null,
    baseRef: string = fallbackRef,
  ): Promise<PreparedWorkspace> {
    assertRunId(runId);
    await mkdir(dirname(mirrorPath), { recursive: true, mode: 0o700 });
    const askpass = await createAskPass();
    try {
      if (!(await exists(mirrorPath))) {
        await git(["clone", "--mirror", cloneUrl, mirrorPath], token, askpass);
      }
      await git(
        [
          "-c",
          "remote.origin.mirror=false",
          "--git-dir",
          mirrorPath,
          "fetch",
          "--prune",
          "--refmap=",
          "origin",
          "+refs/heads/*:refs/remotes/origin/*",
        ],
        token,
        askpass,
      );
      const workspace = join(this.workspacesRoot, "runs", runId, "repository");
      assertWithin(this.workspacesRoot, workspace);
      await mkdir(dirname(workspace), { recursive: true, mode: 0o700 });
      const localBranchExists =
        branchName === null
          ? false
          : await refExists(mirrorPath, `refs/heads/${branchName}`, token, askpass);
      const remoteBranchRef = branchName === null ? null : `refs/remotes/origin/${branchName}`;
      const remoteBranchExists =
        remoteBranchRef === null
          ? false
          : await refExists(mirrorPath, remoteBranchRef, token, askpass);
      const preferredRemoteRef = `refs/remotes/origin/${baseRef}`;
      const preferredLocalRef = `refs/heads/${baseRef}`;
      const fallbackRemoteRef = `refs/remotes/origin/${fallbackRef}`;
      const resolvedBaseRef = (await refExists(mirrorPath, preferredRemoteRef, token, askpass))
        ? preferredRemoteRef
        : baseRef !== fallbackRef &&
            (await refExists(mirrorPath, preferredLocalRef, token, askpass))
          ? preferredLocalRef
          : (await refExists(mirrorPath, fallbackRemoteRef, token, askpass))
            ? fallbackRemoteRef
            : null;
      if (resolvedBaseRef === null) {
        throw new Error(`Base Branch '${fallbackRef}' does not exist in the remote repository.`);
      }
      if (branchName !== null && (localBranchExists || remoteBranchExists)) {
        await removeExistingBranchWorktree(mirrorPath, branchName, workspace, this.workspacesRoot);
      }
      if (branchName !== null && remoteBranchRef !== null && remoteBranchExists) {
        await git(
          ["--git-dir", mirrorPath, "branch", "--force", branchName, remoteBranchRef],
          token,
          askpass,
        );
      }
      await git(
        branchName === null
          ? [
              "--git-dir",
              mirrorPath,
              "worktree",
              "add",
              "--force",
              "--detach",
              workspace,
              resolvedBaseRef,
            ]
          : localBranchExists || remoteBranchExists
            ? ["--git-dir", mirrorPath, "worktree", "add", "--force", workspace, branchName]
            : [
                "--git-dir",
                mirrorPath,
                "worktree",
                "add",
                "--force",
                "-b",
                branchName,
                workspace,
                resolvedBaseRef,
              ],
        token,
        askpass,
      );
      const ownership = Bun.spawn(["chown", "-R", "1000:1000", workspace], {
        stdout: "ignore",
        stderr: "pipe",
      });
      if ((await ownership.exited) !== 0)
        throw new Error("Could not assign workspace ownership to the agent user.");
      const baseSha = (await git(["-C", workspace, "rev-parse", "HEAD"], token, askpass)).trim();
      return { path: workspace, baseSha };
    } finally {
      await rm(askpass.directory, { recursive: true, force: true });
    }
  }

  async commitAndPush(
    workspace: PreparedWorkspace,
    branchName: string,
    token: string,
    message: string,
  ): Promise<string> {
    const askpass = await createAskPass();
    try {
      const status = await git(["-C", workspace.path, "status", "--porcelain"], token, askpass);
      if (status.trim() !== "") {
        await git(["-C", workspace.path, "add", "--all"], token, askpass);
        await git(
          [
            "-C",
            workspace.path,
            "-c",
            "user.name=AIWS Agent",
            "-c",
            "user.email=aiws@local",
            "commit",
            "-m",
            message,
          ],
          token,
          askpass,
        );
      }
      const headSha = (
        await git(["-C", workspace.path, "rev-parse", "HEAD"], token, askpass)
      ).trim();
      if (headSha === workspace.baseSha)
        throw new Error("Agent completed without repository changes.");
      await git(
        [
          "-C",
          workspace.path,
          "-c",
          "remote.origin.mirror=false",
          "push",
          "origin",
          `${branchName}:refs/heads/${branchName}`,
        ],
        token,
        askpass,
      );
      return headSha;
    } finally {
      await rm(askpass.directory, { recursive: true, force: true });
    }
  }

  async resumePublishing(runId: string, expectedBaseSha: string): Promise<PreparedWorkspace> {
    assertRunId(runId);
    const workspace = join(this.workspacesRoot, "runs", runId, "repository");
    assertWithin(this.workspacesRoot, workspace);
    if (!(await exists(workspace)))
      throw new Error("Resume workspace is missing; use a full Retry.");
    const actualBase = (
      await git(["-C", workspace, "merge-base", expectedBaseSha, "HEAD"], "", {
        path: "/bin/false",
      })
    ).trim();
    const headSha = (
      await git(["-C", workspace, "rev-parse", "HEAD"], "", { path: "/bin/false" })
    ).trim();
    const status = await git(["-C", workspace, "status", "--porcelain"], "", {
      path: "/bin/false",
    });
    if (actualBase !== expectedBaseSha || headSha === expectedBaseSha || status.trim() !== "") {
      throw new Error(
        "Resume workspace does not match its publishing checkpoint; use a full Retry.",
      );
    }
    return { path: workspace, baseSha: expectedBaseSha };
  }

  async cleanup(runId: string, mirrorPath: string): Promise<void> {
    assertRunId(runId);
    const runDirectory = join(this.workspacesRoot, "runs", runId);
    const workspace = join(runDirectory, "repository");
    assertWithin(this.workspacesRoot, workspace);
    if (await exists(mirrorPath))
      await git(["--git-dir", mirrorPath, "worktree", "remove", "--force", workspace], "", {
        path: "/bin/false",
      }).catch(() => undefined);
    await rm(runDirectory, { recursive: true, force: true });
  }
}

async function refExists(
  mirrorPath: string,
  reference: string,
  token: string,
  askpass: { readonly path: string },
): Promise<boolean> {
  return git(["--git-dir", mirrorPath, "show-ref", "--verify", reference], token, askpass).then(
    () => true,
    () => false,
  );
}

async function removeExistingBranchWorktree(
  mirrorPath: string,
  branchName: string,
  destination: string,
  workspacesRoot: string,
): Promise<void> {
  const listing = await git(["--git-dir", mirrorPath, "worktree", "list", "--porcelain"], "", {
    path: "/bin/false",
  });
  for (const entry of listing.trim().split("\n\n")) {
    const path = entry.match(/^worktree (.+)$/mu)?.[1];
    const branch = entry.match(/^branch (.+)$/mu)?.[1];
    if (path === undefined || branch !== `refs/heads/${branchName}` || path === destination)
      continue;
    assertWithin(workspacesRoot, path);
    await git(["--git-dir", mirrorPath, "worktree", "remove", "--force", path], "", {
      path: "/bin/false",
    });
    await rm(dirname(path), { recursive: true, force: true });
  }
}

async function git(
  args: readonly string[],
  token: string,
  askpass: { readonly path: string },
): Promise<string> {
  const process = Bun.spawn(
    [
      "git",
      "-c",
      "credential.helper=",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "safe.directory=*",
      ...args,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: Bun.env.PATH ?? "/usr/bin:/bin",
        HOME: "/tmp",
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: askpass.path,
        AIWS_GIT_TOKEN: token,
      },
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) throw new Error(`Git command failed (${code}): ${stderr.slice(0, 2000)}`);
  return stdout;
}
async function createAskPass(): Promise<{ readonly path: string; readonly directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "aiws-askpass-"));
  const path = join(directory, "askpass.sh");
  await writeFile(path, "#!/bin/sh\nprintf '%s' \"$AIWS_GIT_TOKEN\"\n", { mode: 0o700 });
  await chmod(path, 0o700);
  return { path, directory };
}
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
function assertRunId(value: string): void {
  if (!/^run_[0-9A-HJKMNP-TV-Z]{26}$/u.test(value)) throw new Error("Invalid Run ID.");
}
function assertWithin(root: string, candidate: string): void {
  const path = relative(root, candidate);
  if (path.startsWith("..") || path.startsWith("/"))
    throw new Error("Workspace escaped its configured root.");
}
