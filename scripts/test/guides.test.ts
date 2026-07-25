import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const guideNames = [
  "installation.md",
  "agents.md",
  "managed-git-providers.md",
  "projects-and-tasks.md",
] as const;
const read = (path: string) => Bun.file(resolve(root, path)).text();

describe("operator guides", () => {
  test("README routes every audience to the four guides", async () => {
    const readme = await read("README.md");
    expect(readme).toContain("## Empieza aquí");
    for (const name of guideNames) {
      expect(existsSync(resolve(root, "docs/guides", name))).toBeTrue();
      expect(readme).toContain(`./docs/guides/${name}`);
    }
    for (const target of ["./docs/05-cli.md", "./skills/aiws-workflow/SKILL.md", "./PRD.md"]) {
      expect(readme).toContain(target);
    }
  });

  test("all relative Markdown links resolve", async () => {
    const paths = [
      "README.md",
      "distribution/README.md",
      ...guideNames.map((name) => `docs/guides/${name}`),
    ];
    for (const path of paths) {
      const content = await read(path);
      for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
        const target = match[1];
        if (
          target === undefined ||
          target.startsWith("http://") ||
          target.startsWith("https://") ||
          target.startsWith("#")
        ) {
          continue;
        }
        const clean = decodeURIComponent(target.split("#")[0] ?? "");
        if (path === "distribution/README.md" && clean.startsWith("guides/")) {
          expect(existsSync(resolve(root, "docs", clean)), `${path} -> ${target}`).toBeTrue();
          continue;
        }
        expect(existsSync(resolve(root, dirname(path), clean)), `${path} -> ${target}`).toBeTrue();
      }
    }
  });

  test("provider guide fixes callbacks, permissions and exact variable sets", async () => {
    const guide = await read("docs/guides/managed-git-providers.md");
    for (const required of [
      `\${AIWS_PUBLIC_URL}/api/v1/connections/github/callback`,
      `\${AIWS_PUBLIC_URL}/api/v1/connections/azure-devops/callback`,
      "Contents — Read and write",
      "Pull requests — Read and write",
      "user_impersonation",
      "499b84ac-1321-427f-aa17-267ca6975798/.default offline_access",
      "AIWS_GITHUB_APP_ID",
      "AIWS_GITHUB_APP_SLUG",
      "AIWS_GITHUB_PRIVATE_KEY_BASE64",
      "AIWS_AZURE_DEVOPS_CLIENT_ID",
      "AIWS_AZURE_DEVOPS_CLIENT_SECRET",
      "AIWS_CONNECTION_ENCRYPTION_KEY",
    ]) {
      expect(guide).toContain(required);
    }
  });

  test("guides document current CLI and browser-only authorization boundaries", async () => {
    const providers = await read("docs/guides/managed-git-providers.md");
    const workflow = await read("docs/guides/projects-and-tasks.md");
    for (const command of [
      "connection github-install",
      "connection azure-authorize",
      "connection azure-organizations",
      "connection azure-complete",
      "connection repos",
      "connection import",
      "project update",
      "task message",
      "task timeline",
      "run list",
      "task activity",
    ]) {
      expect(`${providers}\n${workflow}`).toContain(command);
    }
    expect(providers).toContain("requiere interacción humana");
    expect(workflow).toContain("--curation-agent-profile");
    expect(workflow).toContain("--implementation-agent-profile");
    expect(workflow).toContain("provider-neutral");
  });

  test("release bundle packages guides and links them locally", async () => {
    const release = await read(".github/workflows/release.yml");
    const readme = await read("distribution/README.md");
    expect(release).toContain("cp -R docs/guides deployment/aiws-deployment/guides");
    for (const name of guideNames) expect(readme).toContain(`guides/${name}`);
  });

  test("example providers are inactive and init rejects partial sets", async () => {
    for (const path of [".env.example", "distribution/config.env.example"]) {
      const example = await read(path);
      for (const variable of [
        "AIWS_GITHUB_APP_ID",
        "AIWS_GITHUB_APP_SLUG",
        "AIWS_GITHUB_PRIVATE_KEY_BASE64",
        "AIWS_AZURE_DEVOPS_CLIENT_ID",
        "AIWS_AZURE_DEVOPS_CLIENT_SECRET",
        "AIWS_CONNECTION_ENCRYPTION_KEY",
      ]) {
        expect(example).toMatch(new RegExp(`^# ${variable}=`, "mu"));
      }
    }
    const script = await read("distribution/init-secrets.sh");
    expect(script).not.toContain("replace-with-github-app-id");
    expect(script).not.toContain("replace-with-entra-application-client-id");

    const temporary = resolve(tmpdir(), `aiws-guide-test-${process.pid}`);
    mkdirSync(temporary, { recursive: true });
    const partial = Bun.spawnSync({
      cmd: ["sh", resolve(root, "distribution/init-secrets.sh")],
      cwd: temporary,
      env: {
        PATH: process.env.PATH ?? "",
        AIWS_IMAGE_NAMESPACE: "example.invalid",
        AIWS_GITHUB_APP_ID: "123",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(partial.exitCode).toBe(1);
    expect(partial.stderr.toString()).toContain("GitHub requires");
  });
});
