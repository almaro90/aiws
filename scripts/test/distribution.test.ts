import { describe, expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(`../../${path}`, import.meta.url)).text();

describe("Hito 23 distribution contracts", () => {
  test("production Compose uses published images, loopback and persistent volumes without builds", async () => {
    const compose = await read("distribution/compose.yaml");
    expect(compose).not.toContain("build:");
    for (const image of ["aiws", "aiws-runner-manager", "aiws-agent"]) {
      expect(compose).toContain(`/${image}:`);
    }
    expect(compose).toContain(`"127.0.0.1:\${AIWS_PORT:-3000}:3000"`);
    for (const volume of ["aiws-data", "aiws-repositories", "aiws-workspaces", "aiws-codex-auth"]) {
      expect(compose).toContain(volume);
    }
  });

  test("Linux installer verifies before atomic installation and preserves configuration", async () => {
    const installer = await read("distribution/install-aiws.sh");
    const checksum = installer.indexOf("sha256sum --check");
    const install = installer.indexOf("install -o root -g root");
    expect(checksum).toBeGreaterThan(0);
    expect(install).toBeGreaterThan(checksum);
    expect(installer).toContain("/usr/local/bin/.aiws.$$");
    expect(installer).toContain("mv -f");
    expect(installer).toContain("aiws-agents");
    expect(installer).toContain("/etc/aiws");
    expect(installer).not.toContain("docker");
    expect(installer).not.toContain("config.json");
  });

  test("bundle secret initialization uses offline helpers and restrictive files", async () => {
    const initializer = await read("distribution/init-secrets.sh");
    for (const command of [
      "hash-password",
      "generate-session-secret",
      "generate-api-token",
      "generate-runner-token",
      "generate-runner-control-secret",
      "generate-notification-encryption-key",
    ]) {
      expect(initializer).toContain(command);
    }
    expect(initializer).toContain("umask 077");
    expect(initializer).toContain("chmod 0600 .env aiws-api-token");
    expect(initializer).toContain("github_count");
    expect(initializer).toContain("azure_count");
    expect(initializer).not.toContain("replace-with-github-app-id");
    expect(initializer).not.toContain("replace-with-entra-application-client-id");
  });

  test("release bundle includes the four local operator guides", async () => {
    const workflow = await read(".github/workflows/release.yml");
    const bundleReadme = await read("distribution/README.md");
    expect(workflow).toContain("cp -R docs/guides deployment/aiws-deployment/guides");
    for (const guide of [
      "installation.md",
      "agents.md",
      "managed-git-providers.md",
      "projects-and-tasks.md",
    ]) {
      expect(bundleReadme).toContain(`guides/${guide}`);
    }
  });

  test("release publishes the full platform and OCI matrix with provenance", async () => {
    const workflow = await read(".github/workflows/release.yml");
    expect(workflow).toContain("bun run --cwd apps/web playwright install --with-deps chromium");
    expect(workflow).not.toContain("bunx playwright install --with-deps chromium");
    for (const target of [
      "linux-x64",
      "linux-arm64",
      "darwin-x64",
      "darwin-arm64",
      "windows-x64",
    ]) {
      expect(workflow).toContain(target);
    }
    expect(workflow).toContain("linux/amd64,linux/arm64");
    expect(workflow).toContain("provenance: mode=max");
    expect(workflow).toContain("sbom: true");
    expect(workflow).toContain("SHA256SUMS");
  });
});
