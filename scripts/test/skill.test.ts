import { describe, expect, test } from "bun:test";

const skillPath = new URL("../../skills/aiws-workflow/SKILL.md", import.meta.url);
const readmePath = new URL("../../README.md", import.meta.url);

describe("AIWS agent skill", () => {
  test("uses the portable Agent Skills frontmatter subset", async () => {
    const content = await Bun.file(skillPath).text();
    const match = content.match(/^---\n([\s\S]*?)\n---\n/u);
    expect(match).not.toBeNull();

    const frontmatter = Bun.YAML.parse(match?.[1] ?? "") as Record<string, unknown>;
    expect(Object.keys(frontmatter).sort()).toEqual(["description", "name"]);
    expect(frontmatter.name).toBe("aiws-workflow");
    expect(frontmatter.description).toBeString();
    expect(content).not.toMatch(/TODO|FIXME/u);
  });

  test("documents the safe curator and implementer workflows", async () => {
    const content = await Bun.file(skillPath).text();
    for (const requirement of [
      "--json",
      "--expected-version",
      "version_conflict",
      "--status curating",
      "--status ready",
      "--to implementing",
      "--to done",
      "project.repositoryPath",
    ]) {
      expect(content).toContain(requirement);
    }
  });

  test("covers Projects, import, Messages and managed Run guards without secrets", async () => {
    const content = await Bun.file(skillPath).text();
    for (const requirement of [
      "connection list",
      "connection repos",
      "connection import",
      "project create",
      "task create",
      "task message",
      "--kind curation",
      "--kind implementation",
      "no reclamar ni modificar el repositorio",
      "connection azure-organizations",
      "connection azure-complete",
      "--curation-agent-profile",
      "--implementation-agent-profile",
      "requiriendo navegador",
      "private keys",
      "client secrets",
      "no modifica `userRequest`",
    ]) {
      expect(content).toContain(requirement);
    }
    expect(content).not.toContain("AIWS_GITHUB_PRIVATE_KEY_BASE64=");
    expect(content).not.toContain("AIWS_AZURE_DEVOPS_CLIENT_SECRET=");
  });

  test("documents installation for Codex, Hermes Agent and OpenClaw", async () => {
    const readme = await Bun.file(readmePath).text();
    expect(readme).toContain(`\${CODEX_HOME:-$HOME/.codex}/skills`);
    expect(readme).toContain("hermes skills install");
    expect(readme).toContain("openclaw skills install /tmp/aiws-v0.8.0/skills/aiws-workflow");
    expect(readme.match(/v0\.8\.0/gu)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
