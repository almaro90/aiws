import { ValidationError } from "@aiws/core";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";

export class RepositoryValidator {
  private constructor(private readonly roots: readonly string[]) {}

  static async create(roots: readonly string[]): Promise<RepositoryValidator> {
    const canonicalRoots = await Promise.all(roots.map((root) => realpath(root)));
    return new RepositoryValidator(canonicalRoots);
  }

  async validate(repositoryPath: string): Promise<string> {
    if (!isAbsolute(repositoryPath)) return invalid("Must be an absolute path.");
    let canonical: string;
    try {
      canonical = await realpath(repositoryPath);
      if (!(await stat(canonical)).isDirectory()) return invalid("Must be a directory.");
    } catch {
      return invalid("Repository path does not exist.");
    }

    if (!this.roots.some((root) => isWithin(root, canonical))) {
      return invalid("Repository path is outside the allowed roots.");
    }

    const process = Bun.spawn(["git", "-C", canonical, "rev-parse", "--is-inside-work-tree"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const output = await new Response(process.stdout).text();
    if ((await process.exited) !== 0 || output.trim() !== "true") {
      return invalid("Repository path is not a Git worktree.");
    }
    return canonical;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function invalid(message: string): never {
  throw new ValidationError([{ path: "repositoryPath", message }]);
}
