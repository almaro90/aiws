import { isAbsolute } from "node:path";
import { z } from "zod";

const integer = (minimum: number, maximum?: number) =>
  z
    .string()
    .regex(/^\d+$/, "must be an integer")
    .transform(Number)
    .pipe(
      maximum === undefined
        ? z.number().int().min(minimum)
        : z.number().int().min(minimum).max(maximum),
    );

const boolean = z.enum(["true", "false"]).transform((value) => value === "true");

const publicUrl = z
  .string()
  .url("must be an absolute HTTP or HTTPS URL")
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "must use HTTP or HTTPS")
  .refine((value) => !value.endsWith("/"), "must not have a trailing slash");

const allowedRepoRoots = z.string().transform((value, context) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    context.addIssue({ code: "custom", message: "must be a JSON array of absolute paths" });
    return z.NEVER;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((item) => typeof item !== "string" || !isAbsolute(item))
  ) {
    context.addIssue({
      code: "custom",
      message: "must be a non-empty JSON array of absolute paths",
    });
    return z.NEVER;
  }
  return parsed as string[];
});

const argon2idHash = z
  .string()
  .regex(
    /^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/._-]+\$[A-Za-z0-9+/._-]+$/,
    "must be an Argon2id PHC string",
  );

const sessionSecret = z.string().refine((value) => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }
  return Buffer.from(value, "base64").byteLength >= 32;
}, "must be valid Base64 encoding at least 32 bytes");

const schema = z
  .object({
    AIWS_ENV: z.enum(["development", "test", "production"]).default("production"),
    AIWS_HOST: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[A-Za-z0-9.:[\]-]+$/, "must be an IP address or hostname")
      .default("0.0.0.0"),
    AIWS_PORT: integer(1, 65_535).prefault("3000"),
    AIWS_DATA_DIR: z.string().refine(isAbsolute, "must be an absolute path").default("/data"),
    AIWS_REPOSITORIES_DIR: z
      .string()
      .refine(isAbsolute, "must be an absolute path")
      .default("/repositories"),
    AIWS_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    AIWS_MAX_ATTACHMENTS_PER_TASK: integer(1, 10).prefault("10"),
    AIWS_MAX_ATTACHMENT_BYTES: integer(1, 26_214_400).prefault("26214400"),
    AIWS_HTTP_BODY_LIMIT_BYTES: integer(1_048_576).prefault("1048576"),
    AIWS_LOGIN_ATTEMPTS: integer(1, 100).prefault("5"),
    AIWS_LOGIN_WINDOW_SECONDS: integer(60).prefault("900"),
    AIWS_SESSION_TTL_SECONDS: integer(900, 604_800).prefault("43200"),
    AIWS_ORPHAN_TTL_SECONDS: integer(3_600).prefault("86400"),
    AIWS_GRACEFUL_SHUTDOWN_MS: integer(1_000, 60_000).prefault("10000"),
    AIWS_TRUST_PROXY: boolean.prefault("false"),
    AIWS_PUBLIC_URL: publicUrl.optional(),
    AIWS_ALLOWED_REPO_ROOTS: allowedRepoRoots.optional(),
    AIWS_ADMIN_USERNAME: z.string().trim().min(1).max(120).optional(),
    AIWS_ADMIN_PASSWORD_HASH: argon2idHash.optional(),
    AIWS_SESSION_SECRET: sessionSecret.optional(),
    AIWS_API_TOKEN_HASH: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/, "must have format sha256:<64 lowercase hex characters>")
      .optional(),
    AIWS_RUNNER_TOKEN_HASH: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/u, "must have format sha256:<64 lowercase hex characters>")
      .optional(),
    AIWS_RUNNER_CONTROL_URL: z.string().url().optional(),
    AIWS_RUNNER_CONTROL_SECRET: z.string().min(32).optional(),
    AIWS_GITHUB_APP_ID: z.string().regex(/^\d+$/u).optional(),
    AIWS_GITHUB_APP_SLUG: z
      .string()
      .regex(/^[a-z0-9-]+$/u)
      .optional(),
    AIWS_GITHUB_PRIVATE_KEY_BASE64: z.string().min(1).optional(),
    AIWS_NOTIFICATION_ENCRYPTION_KEY: z
      .string()
      .refine((value) => {
        const decoded = Buffer.from(value, "base64");
        return (
          decoded.byteLength === 32 &&
          decoded.toString("base64").replace(/=+$/u, "") === value.replace(/=+$/u, "")
        );
      }, "must be Base64 encoding exactly 32 bytes")
      .optional(),
  })
  .superRefine((value, context) => {
    const controlValues = [value.AIWS_RUNNER_CONTROL_URL, value.AIWS_RUNNER_CONTROL_SECRET];
    if (
      controlValues.some((item) => item !== undefined) &&
      controlValues.some((item) => item === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["AIWS_RUNNER_CONTROL_URL"],
        message: "runner control URL and secret must be configured together",
      });
    }
    const githubValues = [
      value.AIWS_GITHUB_APP_ID,
      value.AIWS_GITHUB_APP_SLUG,
      value.AIWS_GITHUB_PRIVATE_KEY_BASE64,
    ];
    if (
      githubValues.some((item) => item !== undefined) &&
      githubValues.some((item) => item === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["AIWS_GITHUB_APP_ID"],
        message: "GitHub App ID, slug and private key must be configured together",
      });
    }
    if (value.AIWS_ENV !== "production") return;

    const required = [
      "AIWS_PUBLIC_URL",
      "AIWS_ALLOWED_REPO_ROOTS",
      "AIWS_ADMIN_USERNAME",
      "AIWS_ADMIN_PASSWORD_HASH",
      "AIWS_SESSION_SECRET",
      "AIWS_API_TOKEN_HASH",
      "AIWS_RUNNER_CONTROL_URL",
      "AIWS_RUNNER_CONTROL_SECRET",
    ] as const;
    for (const name of required) {
      if (value[name] === undefined) {
        context.addIssue({ code: "custom", path: [name], message: "is required in production" });
      }
    }
    if (value.AIWS_PUBLIC_URL && new URL(value.AIWS_PUBLIC_URL).protocol !== "https:") {
      context.addIssue({
        code: "custom",
        path: ["AIWS_PUBLIC_URL"],
        message: "must use HTTPS in production",
      });
    }
  });

type ParsedConfig = z.output<typeof schema>;

type CommonConfig = {
  host: string;
  port: number;
  dataDir: string;
  repositoriesDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
  maxAttachmentsPerTask: number;
  maxAttachmentBytes: number;
  httpBodyLimitBytes: number;
  loginAttempts: number;
  loginWindowSeconds: number;
  sessionTtlSeconds: number;
  orphanTtlSeconds: number;
  gracefulShutdownMs: number;
  trustProxy: boolean;
  runnerTokenHash?: string;
  runnerControlUrl?: string;
  runnerControlSecret?: string;
  githubAppId?: string;
  githubAppSlug?: string;
  githubPrivateKeyBase64?: string;
  notificationEncryptionKey?: string;
};

type Credentials = {
  publicUrl: string;
  allowedRepoRoots: string[];
  adminUsername: string;
  adminPasswordHash: string;
  sessionSecret: string;
  apiTokenHash: string;
};

export type ProductionConfig = CommonConfig & Credentials & { env: "production" };
export type NonProductionConfig = CommonConfig &
  Partial<Credentials> & { env: "development" | "test" };
export type Config = ProductionConfig | NonProductionConfig;

export class ConfigError extends Error {
  readonly variable: string;

  constructor(variable: string, reason: string) {
    super(`Invalid configuration for ${variable}: ${reason}`);
    this.name = "ConfigError";
    this.variable = variable;
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issue = result.error.issues[0];
    const variable = typeof issue?.path[0] === "string" ? issue.path[0] : "environment";
    throw new ConfigError(variable, issue?.message ?? "is invalid");
  }

  return mapConfig(result.data);
}

function mapConfig(value: ParsedConfig): Config {
  const common: CommonConfig = {
    host: value.AIWS_HOST,
    port: value.AIWS_PORT,
    dataDir: value.AIWS_DATA_DIR,
    repositoriesDir: value.AIWS_REPOSITORIES_DIR,
    logLevel: value.AIWS_LOG_LEVEL,
    maxAttachmentsPerTask: value.AIWS_MAX_ATTACHMENTS_PER_TASK,
    maxAttachmentBytes: value.AIWS_MAX_ATTACHMENT_BYTES,
    httpBodyLimitBytes: value.AIWS_HTTP_BODY_LIMIT_BYTES,
    loginAttempts: value.AIWS_LOGIN_ATTEMPTS,
    loginWindowSeconds: value.AIWS_LOGIN_WINDOW_SECONDS,
    sessionTtlSeconds: value.AIWS_SESSION_TTL_SECONDS,
    orphanTtlSeconds: value.AIWS_ORPHAN_TTL_SECONDS,
    gracefulShutdownMs: value.AIWS_GRACEFUL_SHUTDOWN_MS,
    trustProxy: value.AIWS_TRUST_PROXY,
    ...(value.AIWS_RUNNER_TOKEN_HASH === undefined
      ? {}
      : { runnerTokenHash: value.AIWS_RUNNER_TOKEN_HASH }),
    ...(value.AIWS_RUNNER_CONTROL_URL === undefined
      ? {}
      : {
          runnerControlUrl: value.AIWS_RUNNER_CONTROL_URL,
          runnerControlSecret: value.AIWS_RUNNER_CONTROL_SECRET as string,
        }),
    ...(value.AIWS_GITHUB_APP_ID === undefined ? {} : { githubAppId: value.AIWS_GITHUB_APP_ID }),
    ...(value.AIWS_GITHUB_APP_SLUG === undefined
      ? {}
      : { githubAppSlug: value.AIWS_GITHUB_APP_SLUG }),
    ...(value.AIWS_GITHUB_PRIVATE_KEY_BASE64 === undefined
      ? {}
      : { githubPrivateKeyBase64: value.AIWS_GITHUB_PRIVATE_KEY_BASE64 }),
    ...(value.AIWS_NOTIFICATION_ENCRYPTION_KEY === undefined
      ? {}
      : { notificationEncryptionKey: value.AIWS_NOTIFICATION_ENCRYPTION_KEY }),
  };
  const credentials: Partial<Credentials> = {};
  if (value.AIWS_PUBLIC_URL !== undefined) credentials.publicUrl = value.AIWS_PUBLIC_URL;
  if (value.AIWS_ALLOWED_REPO_ROOTS !== undefined) {
    credentials.allowedRepoRoots = value.AIWS_ALLOWED_REPO_ROOTS;
  }
  if (value.AIWS_ADMIN_USERNAME !== undefined) {
    credentials.adminUsername = value.AIWS_ADMIN_USERNAME;
  }
  if (value.AIWS_ADMIN_PASSWORD_HASH !== undefined) {
    credentials.adminPasswordHash = value.AIWS_ADMIN_PASSWORD_HASH;
  }
  if (value.AIWS_SESSION_SECRET !== undefined) {
    credentials.sessionSecret = value.AIWS_SESSION_SECRET;
  }
  if (value.AIWS_API_TOKEN_HASH !== undefined) {
    credentials.apiTokenHash = value.AIWS_API_TOKEN_HASH;
  }

  if (value.AIWS_ENV === "production") {
    return {
      ...common,
      env: value.AIWS_ENV,
      publicUrl: credentials.publicUrl as string,
      allowedRepoRoots: credentials.allowedRepoRoots as string[],
      adminUsername: credentials.adminUsername as string,
      adminPasswordHash: credentials.adminPasswordHash as string,
      sessionSecret: credentials.sessionSecret as string,
      apiTokenHash: credentials.apiTokenHash as string,
    };
  }

  return { ...common, env: value.AIWS_ENV, ...credentials };
}
