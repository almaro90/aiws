import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitWorkspaceManager } from "../src/workspace.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("Git workspace manager", () => {
  test("creates an isolated worktree, commits, pushes and cleans it", async () => {
    const root = await mkdtemp(join(tmpdir(), "aiws-runner-test-"));
    directories.push(root);
    const source = join(root, "source");
    const remote = join(root, "remote.git");
    const workspaces = join(root, "workspaces");
    await mkdir(source);
    await command(["git", "init", "--quiet", "--initial-branch=main", source]);
    await writeFile(join(source, "README.md"), "initial\n");
    await command([
      "git",
      "-C",
      source,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "add",
      ".",
    ]);
    await command([
      "git",
      "-C",
      source,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--quiet",
      "-m",
      "initial",
    ]);
    await command(["git", "clone", "--quiet", "--bare", source, remote]);
    const manager = new GitWorkspaceManager(workspaces);
    const runId = `run_${"0".repeat(26)}`;
    const mirror = join(root, "mirror.git");
    const prepared = await manager.prepare(runId, mirror, remote, "", "main", `aiws/test/${runId}`);
    await writeFile(join(prepared.path, "change.txt"), "changed\n");
    const head = await manager.commitAndPush(prepared, `aiws/test/${runId}`, "", "aiws: test");
    expect(head).toHaveLength(40);
    expect((await command(["git", "--git-dir", remote, "show", `${head}:change.txt`])).trim()).toBe(
      "changed",
    );
    const curationRunId = `run_${"2".repeat(26)}`;
    const curation = await manager.prepare(
      curationRunId,
      mirror,
      remote,
      "",
      "main",
      null,
      `aiws/test/${runId}`,
    );
    expect(curation.baseSha).toBe(head);
    expect((await command(["git", "-C", prepared.path, "branch", "--show-current"])).trim()).toBe(
      `aiws/test/${runId}`,
    );
    await manager.cleanup(curationRunId, mirror);
    expect(await manager.resumePublishing(runId, prepared.baseSha)).toEqual(prepared);
    await writeFile(join(prepared.path, "partial.txt"), "not checkpointed\n");
    await expect(manager.resumePublishing(runId, prepared.baseSha)).rejects.toThrow(
      "does not match its publishing checkpoint",
    );
    await rm(join(prepared.path, "partial.txt"));
    await expect(manager.resumePublishing(runId, "f".repeat(40))).rejects.toThrow();
    await manager.cleanup(runId, mirror);

    const fallbackRunId = `run_${"1".repeat(26)}`;
    const fallback = await manager.prepare(
      fallbackRunId,
      join(root, "fallback-mirror.git"),
      remote,
      "",
      "main",
      "aiws/test/fallback",
      "aiws/test/missing-delivery",
    );
    expect((await command(["git", "-C", fallback.path, "branch", "--show-current"])).trim()).toBe(
      "aiws/test/fallback",
    );
    expect(fallback.baseSha).toHaveLength(40);
    await manager.cleanup(fallbackRunId, join(root, "fallback-mirror.git"));
  });
});

async function command(args: string[]): Promise<string> {
  const process = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) throw new Error(stderr);
  return stdout;
}
