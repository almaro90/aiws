import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const guideNames = [
  "installation.md",
  "agents.md",
  "managed-git-providers.md",
  "projects-and-tasks.md",
] as const;
const read = (path: string) => Bun.file(resolve(root, path)).text();
const requiredInitializerEnvironment = {
  AIWS_IMAGE_NAMESPACE: "example.invalid",
  AIWS_PUBLIC_URL: "https://required.example.com",
  AIWS_ALLOWED_REPO_ROOTS: '["/srv/required-repos"]',
  AIWS_REPO_ROOT: "/srv/required-repos",
  AIWS_ADMIN_USERNAME: "required-admin",
} as const;

function createFakeDocker(directory: string): { bin: string; marker: string } {
  const bin = join(directory, "bin");
  const marker = join(directory, "docker-called");
  mkdirSync(bin);
  const executable = join(bin, "docker");
  writeFileSync(
    executable,
    `#!/bin/sh
set -eu
: >"\${AIWS_DOCKER_MARKER}"
for argument do command="\${argument}"; done
case "\${command}" in
  hash-password) printf '%s\\n' '$argon2id$v=19$test-hash' ;;
  generate-session-secret) printf '%s\\n' 'generated-session-secret' ;;
  generate-notification-encryption-key) printf '%s\\n' 'AIWS_NOTIFICATION_ENCRYPTION_KEY=generated-notification-key' ;;
  generate-api-token)
    printf '%s\\n' 'AIWS_API_TOKEN=generated-api-token'
    printf '%s\\n' 'AIWS_API_TOKEN_HASH=sha256:generated-api-token-hash'
    ;;
  generate-runner-token)
    printf '%s\\n' 'AIWS_RUNNER_TOKEN=generated-runner-token'
    printf '%s\\n' 'AIWS_RUNNER_TOKEN_HASH=sha256:generated-runner-token-hash'
    ;;
  generate-runner-control-secret) printf '%s\\n' 'AIWS_RUNNER_CONTROL_SECRET=generated-runner-control-secret' ;;
  *) exit 2 ;;
esac
`,
  );
  chmodSync(executable, 0o755);
  return { bin, marker };
}

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

    const temporary = mkdtempSync(join(tmpdir(), "aiws-guide-test-"));
    try {
      const partial = Bun.spawnSync({
        cmd: ["sh", resolve(root, "distribution/init-secrets.sh")],
        cwd: temporary,
        env: {
          PATH: process.env.PATH ?? "",
          ...requiredInitializerEnvironment,
          AIWS_GITHUB_APP_ID: "123",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(partial.exitCode).toBe(1);
      expect(partial.stderr.toString()).toContain("GitHub requires");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  for (const missing of [
    "AIWS_PUBLIC_URL",
    "AIWS_ALLOWED_REPO_ROOTS",
    "AIWS_REPO_ROOT",
    "AIWS_ADMIN_USERNAME",
  ] as const) {
    test(`init rejects missing or empty ${missing} before Docker`, () => {
      const temporary = mkdtempSync(join(tmpdir(), "aiws-init-required-"));
      try {
        const fakeDocker = createFakeDocker(temporary);
        for (const state of ["absent", "empty"]) {
          const environment: Record<string, string> = {
            PATH: `${fakeDocker.bin}:${process.env.PATH ?? ""}`,
            AIWS_DOCKER_MARKER: fakeDocker.marker,
            ...requiredInitializerEnvironment,
          };
          if (state === "absent") delete environment[missing];
          else environment[missing] = "";

          const result = Bun.spawnSync({
            cmd: ["sh", resolve(root, "distribution/init-secrets.sh")],
            cwd: temporary,
            env: environment,
            stdout: "pipe",
            stderr: "pipe",
          });
          expect(result.exitCode).toBe(1);
          expect(result.stderr.toString().trim()).toBe(
            `Required environment variable ${missing} is missing or empty.`,
          );
        }
        expect(existsSync(fakeDocker.marker)).toBeFalse();
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    });
  }

  test("init preserves required values, generates credentials and writes mode 0600", () => {
    const temporary = mkdtempSync(join(tmpdir(), "aiws-init-success-"));
    try {
      const fakeDocker = createFakeDocker(temporary);
      const supplied = {
        AIWS_PUBLIC_URL: "https://operator.example.com",
        AIWS_ALLOWED_REPO_ROOTS: '["/srv/operator repos"]',
        AIWS_REPO_ROOT: "/srv/operator repos",
        AIWS_ADMIN_USERNAME: "operator-admin",
      };
      const result = Bun.spawnSync({
        cmd: ["sh", resolve(root, "distribution/init-secrets.sh")],
        cwd: temporary,
        env: {
          PATH: `${fakeDocker.bin}:${process.env.PATH ?? ""}`,
          AIWS_DOCKER_MARKER: fakeDocker.marker,
          AIWS_IMAGE_NAMESPACE: "registry.example.com/operator",
          ...supplied,
        },
        stdin: new TextEncoder().encode("not-used-by-fake-docker\n"),
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(fakeDocker.marker)).toBeTrue();

      const environment = readFileSync(join(temporary, ".env"), "utf8");
      for (const [name, value] of Object.entries(supplied)) {
        expect(environment.match(new RegExp(`^${name}=.*$`, "mu"))?.[0]).toBe(`${name}=${value}`);
      }
      for (const generated of [
        "AIWS_ADMIN_PASSWORD_HASH='$argon2id$v=19$test-hash'",
        "AIWS_SESSION_SECRET=generated-session-secret",
        "AIWS_NOTIFICATION_ENCRYPTION_KEY=generated-notification-key",
        "AIWS_API_TOKEN_HASH=sha256:generated-api-token-hash",
        "AIWS_RUNNER_TOKEN=generated-runner-token",
        "AIWS_RUNNER_TOKEN_HASH=sha256:generated-runner-token-hash",
        "AIWS_RUNNER_CONTROL_SECRET=generated-runner-control-secret",
      ]) {
        expect(environment).toContain(generated);
      }
      expect(readFileSync(join(temporary, "aiws-api-token"), "utf8")).toBe("generated-api-token\n");
      expect(statSync(join(temporary, ".env")).mode & 0o777).toBe(0o600);
      expect(statSync(join(temporary, "aiws-api-token")).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
