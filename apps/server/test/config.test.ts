import { describe, expect, test } from "bun:test";
import { ConfigError, loadConfig } from "../src/config.ts";

const validProduction = {
  AIWS_ENV: "production",
  AIWS_PUBLIC_URL: "https://aiws.example.com",
  AIWS_ALLOWED_REPO_ROOTS: '["/srv/repos/personal","/srv/repos/work"]',
  AIWS_ADMIN_USERNAME: "admin",
  AIWS_ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2h2YWx1ZQ",
  AIWS_SESSION_SECRET: Buffer.alloc(32, 7).toString("base64"),
  AIWS_API_TOKEN_HASH: `sha256:${"a".repeat(64)}`,
  AIWS_RUNNER_CONTROL_URL: "http://runner-manager:4318",
  AIWS_RUNNER_CONTROL_SECRET: "c".repeat(32),
} as const;

describe("loadConfig", () => {
  test("applies every documented default outside production", () => {
    expect(loadConfig({ AIWS_ENV: "development" })).toEqual({
      env: "development",
      host: "0.0.0.0",
      port: 3000,
      dataDir: "/data",
      repositoriesDir: "/repositories",
      logLevel: "info",
      maxAttachmentsPerTask: 10,
      maxAttachmentBytes: 26_214_400,
      httpBodyLimitBytes: 1_048_576,
      loginAttempts: 5,
      loginWindowSeconds: 900,
      sessionTtlSeconds: 43_200,
      orphanTtlSeconds: 86_400,
      gracefulShutdownMs: 10_000,
      trustProxy: false,
    });
  });

  test("returns a production-discriminated config with required credentials", () => {
    const config = loadConfig(validProduction);

    expect(config.env).toBe("production");
    if (config.env !== "production") throw new Error("Expected production config");
    expect(config.publicUrl).toBe(validProduction.AIWS_PUBLIC_URL);
    expect(config.allowedRepoRoots).toEqual(["/srv/repos/personal", "/srv/repos/work"]);
    expect(config.adminUsername).toBe("admin");
  });

  test.each(["development", "test"] as const)(
    "allows %s without credentials and validates optional credentials",
    (environment) => {
      const config = loadConfig({
        ...validProduction,
        AIWS_ENV: environment,
        AIWS_PUBLIC_URL: "http://localhost:3000",
      });
      expect(config.env).toBe(environment);
      expect(config.publicUrl).toBe("http://localhost:3000");
    },
  );

  test("parses JSON, integer and boolean values", () => {
    const config = loadConfig({
      AIWS_ENV: "test",
      AIWS_ALLOWED_REPO_ROOTS: '["/one","/two"]',
      AIWS_PORT: "4000",
      AIWS_MAX_ATTACHMENTS_PER_TASK: "3",
      AIWS_MAX_ATTACHMENT_BYTES: "1024",
      AIWS_HTTP_BODY_LIMIT_BYTES: "2097152",
      AIWS_LOGIN_ATTEMPTS: "9",
      AIWS_LOGIN_WINDOW_SECONDS: "120",
      AIWS_SESSION_TTL_SECONDS: "1800",
      AIWS_ORPHAN_TTL_SECONDS: "7200",
      AIWS_GRACEFUL_SHUTDOWN_MS: "5000",
      AIWS_TRUST_PROXY: "true",
      AIWS_NOTIFICATION_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
    });

    expect(config.allowedRepoRoots).toEqual(["/one", "/two"]);
    expect(config.port).toBe(4000);
    expect(config.maxAttachmentsPerTask).toBe(3);
    expect(config.maxAttachmentBytes).toBe(1024);
    expect(config.httpBodyLimitBytes).toBe(2_097_152);
    expect(config.loginAttempts).toBe(9);
    expect(config.loginWindowSeconds).toBe(120);
    expect(config.sessionTtlSeconds).toBe(1800);
    expect(config.orphanTtlSeconds).toBe(7200);
    expect(config.gracefulShutdownMs).toBe(5000);
    expect(config.trustProxy).toBe(true);
    expect(config.notificationEncryptionKey).toBe(Buffer.alloc(32, 4).toString("base64"));
  });

  test.each([
    ["AIWS_PORT", "0"],
    ["AIWS_PORT", "65536"],
    ["AIWS_MAX_ATTACHMENTS_PER_TASK", "11"],
    ["AIWS_MAX_ATTACHMENT_BYTES", "26214401"],
    ["AIWS_HTTP_BODY_LIMIT_BYTES", "1048575"],
    ["AIWS_LOGIN_ATTEMPTS", "101"],
    ["AIWS_LOGIN_WINDOW_SECONDS", "59"],
    ["AIWS_SESSION_TTL_SECONDS", "899"],
    ["AIWS_SESSION_TTL_SECONDS", "604801"],
    ["AIWS_ORPHAN_TTL_SECONDS", "3599"],
    ["AIWS_GRACEFUL_SHUTDOWN_MS", "999"],
    ["AIWS_GRACEFUL_SHUTDOWN_MS", "60001"],
    ["AIWS_TRUST_PROXY", "yes"],
  ])("rejects the documented boundary for %s", (variable, value) => {
    expect(() => loadConfig({ AIWS_ENV: "test", [variable]: value })).toThrow(variable);
  });

  test.each([
    ["AIWS_PUBLIC_URL", "https://example.com/"],
    ["AIWS_PUBLIC_URL", "ftp://example.com"],
    ["AIWS_ALLOWED_REPO_ROOTS", "not-json"],
    ["AIWS_ALLOWED_REPO_ROOTS", '["relative"]'],
    ["AIWS_ADMIN_PASSWORD_HASH", "not-an-argon-hash"],
    ["AIWS_SESSION_SECRET", Buffer.alloc(31).toString("base64")],
    ["AIWS_SESSION_SECRET", "not base64"],
    ["AIWS_API_TOKEN_HASH", `sha256:${"A".repeat(64)}`],
    ["AIWS_NOTIFICATION_ENCRYPTION_KEY", Buffer.alloc(31).toString("base64")],
  ])("validates optional format for %s", (variable, value) => {
    expect(() => loadConfig({ AIWS_ENV: "test", [variable]: value })).toThrow(variable);
  });

  test("requires production credentials, runner control and HTTPS", () => {
    expect(() => loadConfig({})).toThrow("AIWS_PUBLIC_URL");
    expect(() =>
      loadConfig({ ...validProduction, AIWS_PUBLIC_URL: "http://aiws.example.com" }),
    ).toThrow("AIWS_PUBLIC_URL");
  });

  test.each([
    "AIWS_ADMIN_PASSWORD_HASH",
    "AIWS_SESSION_SECRET",
    "AIWS_API_TOKEN_HASH",
    "AIWS_NOTIFICATION_ENCRYPTION_KEY",
  ])("never exposes the received secret for %s", (variable) => {
    const received = `received-secret-${variable}`;
    let thrown: unknown;
    try {
      loadConfig({ AIWS_ENV: "test", [variable]: received });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigError);
    expect(String(thrown)).toContain(variable);
    expect(String(thrown)).not.toContain(received);
  });
});
