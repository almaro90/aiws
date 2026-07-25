import { rename, unlink } from "node:fs/promises";
import { apiBaseUrl, createApiClient } from "@aiws/api-client";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import {
  type CliConfig,
  type ConfigPaths,
  configPaths,
  DEFAULT_API_URL,
  LocalCliError,
  PartialCliError,
  resolveConfig,
  resolveDisplayConfig,
  setPersistentConfig,
  unsetPersistentConfig,
} from "./config.ts";
import { type CliIo, processIo, readTextInput, writeError, writeResult } from "./io.ts";

type Environment = Readonly<Record<string, string | undefined>>;
type ApiResult<T> = Promise<{ data?: T; error?: unknown; response: Response }>;
const CLI_VERSION = "0.6.0";

type DoctorStatus = "pass" | "warning" | "fail" | "skipped";
interface DoctorCheck {
  readonly name: string;
  readonly status: DoctorStatus;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}
interface DoctorResult {
  readonly ok: boolean;
  readonly cliVersion: string;
  readonly apiUrl: string;
  readonly checks: readonly DoctorCheck[];
}

class DoctorExit extends Error {
  constructor(readonly exitCode: number) {
    super("Doctor completed with failures.");
  }
}

export interface ProgramDependencies {
  readonly io?: CliIo;
  readonly environment?: Environment;
  readonly fetch?: typeof globalThis.fetch;
  readonly configPaths?: ConfigPaths;
}

export function createProgram(dependencies: ProgramDependencies = {}): Command {
  const io = dependencies.io ?? processIo;
  const environment = dependencies.environment ?? process.env;
  const paths = dependencies.configPaths ?? configPaths(environment);
  const program = new Command()
    .name("aiws")
    .description("AIWS HTTP command-line client")
    .version(CLI_VERSION)
    .option("--api-url <url>", "AIWS server URL")
    .option("--token <token>", "Bearer token")
    .option("--json", "emit compact JSON");
  program.configureOutput({
    writeOut: (value) => io.stdout(value),
    writeErr: (value) => {
      if (!program.opts().json) io.stderr(value);
    },
  });
  program.exitOverride();

  const context = (): { config: CliConfig; client: ReturnType<typeof createApiClient> } => {
    const config = resolveConfig(program.opts(), environment, paths);
    return {
      config,
      client: createApiClient({
        apiUrl: config.apiUrl,
        token: config.token,
        timeoutMs: config.httpTimeoutMs,
        ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
      }),
    };
  };
  const emit = (value: unknown, config: CliConfig) => writeResult(io, value, config.json);

  addConfigCommands(program, io, environment, paths);
  addDoctorCommand(program, io, environment, paths, dependencies.fetch);
  addProjectCommands(program, context, emit);
  addTaskCommands(program, context, emit, io, dependencies.fetch);
  addConnectionCommands(program, context, emit);
  addAgentProfileCommands(program, context, emit);
  addRunCommands(program, context, emit);
  addRunnerCommands(program, context, emit);
  return program;
}

function addDoctorCommand(
  program: Command,
  io: CliIo,
  environment: Environment,
  paths: ConfigPaths,
  injectedFetch: typeof globalThis.fetch | undefined,
): void {
  program
    .command("doctor")
    .description("Diagnose CLI and Server connectivity without changing state")
    .action(async () => {
      const options = program.opts();
      const json = Boolean(options.json);
      const checks: DoctorCheck[] = [];
      let apiUrl = DEFAULT_API_URL;
      let config: CliConfig | undefined;
      let configurationReadable = false;

      try {
        const display = resolveDisplayConfig(options, environment, paths);
        apiUrl = display.apiUrl;
        configurationReadable = true;
        const tokenConfigured = display.token !== null;
        try {
          config = resolveConfig(options, environment, paths);
          checks.push(
            doctorCheck("configuration", "pass", "Effective configuration is valid.", {
              tokenConfigured: true,
            }),
          );
        } catch (error) {
          checks.push(
            doctorCheck("configuration", "fail", safeLocalMessage(error), {
              tokenConfigured,
            }),
          );
        }
      } catch (error) {
        checks.push(
          doctorCheck("configuration", "fail", safeLocalMessage(error), {
            tokenConfigured: false,
          }),
        );
      }

      const timeoutMs = config?.httpTimeoutMs ?? doctorTimeout(environment);
      const fetcher = injectedFetch ?? globalThis.fetch;
      let healthVersion: string | undefined;
      let healthPassed = false;
      let networkFailure = false;
      let serverFailure = false;
      let authenticationInvalid = false;

      if (!configurationReadable) {
        checks.push(
          skippedDoctorCheck("health", "Health was skipped because configuration is invalid."),
        );
      } else {
        try {
          const response = await fetcher(`${apiBaseUrl(apiUrl)}/health`, {
            signal: AbortSignal.timeout(timeoutMs),
          });
          const body = await safeJson(response);
          if (
            !response.ok ||
            !isRecord(body) ||
            body.status !== "ok" ||
            typeof body.version !== "string"
          ) {
            serverFailure = true;
            checks.push(
              doctorCheck("health", "fail", "Server health is unavailable or invalid.", {
                httpStatus: response.status,
              }),
            );
          } else {
            healthPassed = true;
            healthVersion = body.version;
            checks.push(
              doctorCheck("health", "pass", "Server health is OK.", {
                serverVersion: healthVersion,
              }),
            );
          }
        } catch {
          networkFailure = true;
          checks.push(
            doctorCheck("health", "fail", "Could not reach the Server before the timeout.", {}),
          );
        }
      }

      if (!healthPassed) {
        checks.push(
          skippedDoctorCheck("version", "Version comparison was skipped because health failed."),
        );
      } else if (healthVersion === CLI_VERSION) {
        checks.push(
          doctorCheck("version", "pass", "CLI and Server versions match.", {
            serverVersion: healthVersion,
          }),
        );
      } else {
        checks.push(
          doctorCheck("version", "warning", "CLI and Server versions differ.", {
            serverVersion: healthVersion,
          }),
        );
      }

      let authenticated = false;
      let connections: unknown[] | undefined;
      if (!healthPassed || config === undefined) {
        checks.push(
          skippedDoctorCheck(
            "authentication",
            config === undefined
              ? "Bearer authentication was skipped because no valid token is configured."
              : "Bearer authentication was skipped because health failed.",
          ),
        );
      } else {
        try {
          const response = await doctorRequest(fetcher, apiUrl, config, "/connections");
          const body = await safeJson(response);
          if (response.status === 401 || response.status === 403) {
            authenticationInvalid = true;
            checks.push(doctorCheck("authentication", "fail", "Bearer authentication failed.", {}));
          } else if (!response.ok || !Array.isArray(body)) {
            serverFailure = true;
            checks.push(
              doctorCheck(
                "authentication",
                "fail",
                "The Server returned an invalid authentication probe response.",
                { httpStatus: response.status },
              ),
            );
          } else {
            authenticated = true;
            connections = body;
            checks.push(
              doctorCheck("authentication", "pass", "Bearer authentication succeeded.", {}),
            );
          }
        } catch {
          networkFailure = true;
          checks.push(
            doctorCheck(
              "authentication",
              "fail",
              "Authentication could not be verified before the timeout.",
              {},
            ),
          );
        }
      }

      if (!authenticated || config === undefined) {
        checks.push(
          skippedDoctorCheck("runner", "Runner status was skipped because authentication failed."),
        );
        checks.push(
          skippedDoctorCheck(
            "connections",
            "Connections summary was skipped because authentication failed.",
          ),
        );
        checks.push(
          skippedDoctorCheck(
            "agent_profiles",
            "Agent Profiles summary was skipped because authentication failed.",
          ),
        );
      } else {
        try {
          const response = await doctorRequest(fetcher, apiUrl, config, "/system/runner");
          const body = await safeJson(response);
          if (
            !response.ok ||
            !isRecord(body) ||
            !["online", "offline", "unknown"].includes(String(body.status))
          ) {
            serverFailure = true;
            checks.push(
              doctorCheck("runner", "fail", "The Server returned an invalid runner status.", {
                httpStatus: response.status,
              }),
            );
          } else {
            const status = String(body.status);
            checks.push(
              doctorCheck(
                "runner",
                status === "online" ? "pass" : "warning",
                status === "online" ? "Runner is online." : `Runner status is ${status}.`,
                { status },
              ),
            );
          }
        } catch {
          networkFailure = true;
          checks.push(
            doctorCheck(
              "runner",
              "fail",
              "Runner status could not be read before the timeout.",
              {},
            ),
          );
        }

        const connectionSummary = summarizeConnections(connections ?? []);
        checks.push(
          doctorCheck(
            "connections",
            connectionSummary.reauthorizationRequired > 0 ? "warning" : "pass",
            connectionSummary.reauthorizationRequired > 0
              ? "One or more Connections require reauthorization."
              : "Connections do not require reauthorization.",
            connectionSummary,
          ),
        );

        try {
          const response = await doctorRequest(fetcher, apiUrl, config, "/agent-profiles");
          const body = await safeJson(response);
          if (!response.ok || !Array.isArray(body)) {
            serverFailure = true;
            checks.push(
              doctorCheck(
                "agent_profiles",
                "fail",
                "The Server returned an invalid Agent Profiles response.",
                { httpStatus: response.status },
              ),
            );
          } else {
            const summary = summarizeAgentProfiles(body);
            const warning = summary.total === 0 || summary.disabled > 0;
            checks.push(
              doctorCheck(
                "agent_profiles",
                warning ? "warning" : "pass",
                summary.total === 0
                  ? "No Agent Profiles are configured."
                  : summary.disabled > 0
                    ? "One or more Agent Profiles are disabled."
                    : "All Agent Profiles are enabled.",
                summary,
              ),
            );
          }
        } catch {
          networkFailure = true;
          checks.push(
            doctorCheck(
              "agent_profiles",
              "fail",
              "Agent Profiles could not be read before the timeout.",
              {},
            ),
          );
        }
      }

      const result: DoctorResult = {
        ok: checks.every((check) => check.status !== "fail"),
        cliVersion: CLI_VERSION,
        apiUrl: safeApiUrl(apiUrl),
        checks,
      };
      if (json) io.stdout(`${JSON.stringify(result)}\n`);
      else writeDoctorHuman(io, result);

      const configurationFailed = checks[0]?.status === "fail";
      const exitCode =
        configurationFailed || authenticationInvalid
          ? 3
          : networkFailure
            ? 7
            : serverFailure
              ? 6
              : 0;
      if (exitCode !== 0) throw new DoctorExit(exitCode);
    });
}

function doctorCheck(
  name: string,
  status: DoctorStatus,
  message: string,
  details: Readonly<Record<string, unknown>>,
): DoctorCheck {
  return { name, status, message, details };
}

function skippedDoctorCheck(name: string, message: string): DoctorCheck {
  return doctorCheck(name, "skipped", message, {});
}

function safeLocalMessage(error: unknown): string {
  return error instanceof LocalCliError ? error.message : "Effective configuration is invalid.";
}

function doctorTimeout(environment: Environment): number {
  const parsed = Number(environment.AIWS_HTTP_TIMEOUT_MS);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 30_000;
}

async function doctorRequest(
  fetcher: typeof globalThis.fetch,
  apiUrl: string,
  config: CliConfig,
  path: string,
): Promise<Response> {
  return fetcher(`${apiBaseUrl(apiUrl)}${path}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(config.httpTimeoutMs),
  });
}

async function safeJson(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined);
}

function summarizeConnections(connections: readonly unknown[]): {
  readonly total: number;
  readonly byProvider: Readonly<Record<string, number>>;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly reauthorizationRequired: number;
} {
  const byProvider: Record<string, number> = { github: 0, azure_devops: 0 };
  const byStatus: Record<string, number> = {
    active: 0,
    reauthorization_required: 0,
    revoked: 0,
  };
  for (const item of connections) {
    if (!isRecord(item)) continue;
    if (typeof item.provider === "string" && item.provider in byProvider) {
      byProvider[item.provider] = (byProvider[item.provider] ?? 0) + 1;
    }
    if (typeof item.status === "string" && item.status in byStatus) {
      byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    }
  }
  return {
    total: connections.length,
    byProvider,
    byStatus,
    reauthorizationRequired: byStatus.reauthorization_required ?? 0,
  };
}

function summarizeAgentProfiles(profiles: readonly unknown[]): {
  readonly total: number;
  readonly enabled: number;
  readonly disabled: number;
} {
  let enabled = 0;
  let disabled = 0;
  for (const item of profiles) {
    if (isRecord(item) && item.enabled === true) enabled += 1;
    else if (isRecord(item) && item.enabled === false) disabled += 1;
  }
  return { total: profiles.length, enabled, disabled };
}

function writeDoctorHuman(io: CliIo, result: DoctorResult): void {
  io.stdout(`AIWS doctor ${result.ok ? "completed" : "found failures"}\n`);
  io.stdout(`CLI ${result.cliVersion} · API ${result.apiUrl}\n`);
  for (const check of result.checks) {
    const details =
      Object.keys(check.details).length === 0 ? "" : ` ${JSON.stringify(check.details)}`;
    io.stdout(`[${check.status.toUpperCase()}] ${check.name}: ${check.message}${details}\n`);
  }
}

function safeApiUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "") {
      url.username = "";
      url.password = "";
    }
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return DEFAULT_API_URL;
  }
}

function addConfigCommands(
  program: Command,
  io: CliIo,
  environment: Environment,
  paths: ConfigPaths,
): void {
  const config = program.command("config").description("Manage persistent CLI configuration");
  const selectedPath = (system: boolean): string => (system ? paths.system : paths.user);
  const jsonEnabled = (): boolean => Boolean(program.opts().json);
  const emitConfig = (value: unknown): void => writeResult(io, value, jsonEnabled());

  config
    .command("path")
    .option("--system", "show the system configuration path")
    .action((options) => {
      const scope = options.system ? "system" : "user";
      const path = selectedPath(Boolean(options.system));
      if (jsonEnabled()) emitConfig({ path, scope });
      else io.stdout(`${path}\n`);
    });

  config
    .command("show")
    .description("Show effective configuration with the token redacted")
    .action(() => {
      emitConfig(resolveDisplayConfig(program.opts(), environment, paths));
    });

  config
    .command("set")
    .description("Set user or system configuration")
    .option("--system", "write system configuration")
    .option("--url <url>", "AIWS server URL")
    .option("--token-stdin", "read the bearer token from stdin or a hidden TTY prompt")
    .action(async (options) => {
      const token = options.tokenStdin
        ? await (io.readSecret?.("AIWS API token: ") ?? io.readStdin())
        : undefined;
      const stored = setPersistentConfig(
        selectedPath(Boolean(options.system)),
        {
          ...(options.url === undefined ? {} : { apiUrl: options.url }),
          ...(token === undefined ? {} : { token: token.replace(/[\r\n]+$/u, "") }),
        },
        Boolean(options.system),
      );
      emitConfig({
        ...(stored.apiUrl === undefined ? {} : { apiUrl: stored.apiUrl }),
        token: stored.token === undefined ? null : "[REDACTED]",
      });
    });

  config
    .command("unset")
    .description("Unset selected values, or the entire configuration when no field is selected")
    .option("--system", "write system configuration")
    .option("--url", "unset the server URL")
    .option("--credential", "unset the bearer token")
    .action((options) => {
      const fields: ("apiUrl" | "token")[] = [];
      if (options.url) fields.push("apiUrl");
      if (options.credential) fields.push("token");
      const stored = unsetPersistentConfig(
        selectedPath(Boolean(options.system)),
        fields,
        Boolean(options.system),
      );
      emitConfig({
        ...(stored.apiUrl === undefined ? {} : { apiUrl: stored.apiUrl }),
        token: stored.token === undefined ? null : "[REDACTED]",
      });
    });
}

function addConnectionCommands(
  program: Command,
  context: () => { config: CliConfig; client: ReturnType<typeof createApiClient> },
  emit: (value: unknown, config: CliConfig) => void,
): void {
  const connection = program.command("connection").description("Manage Git provider connections");
  connection.command("list").action(async () => {
    const { config, client } = context();
    emit(await unwrap(client.GET("/connections")), config);
  });
  connection
    .command("github-install")
    .option("--return-to <path>", "Web path after installation", "/projects")
    .action(async (options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.GET("/connections/github/install", {
            params: { query: { returnTo: options.returnTo } },
          }),
        ),
        config,
      );
    });
  connection.command("azure-authorize").action(async () => {
    const { config, client } = context();
    emit(await unwrap(client.GET("/connections/azure-devops/authorize")), config);
  });
  connection
    .command("azure-organizations")
    .argument("<authorization-id>")
    .action(async (authorizationId) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.GET("/connections/azure-devops/authorizations/{authorizationId}/organizations", {
            params: { path: { authorizationId } },
          }),
        ),
        config,
      );
    });
  connection
    .command("azure-complete")
    .argument("<authorization-id>")
    .requiredOption("--organization-id <organization-id>")
    .action(async (authorizationId, options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.POST("/connections/azure-devops/authorizations/{authorizationId}/complete", {
            params: { path: { authorizationId } },
            body: { organizationId: options.organizationId },
          }),
        ),
        config,
      );
    });
  connection
    .command("reauthorize")
    .argument("<connection-id>")
    .action(async (connectionId) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.GET("/connections/{connectionId}/reauthorize", {
            params: { path: { connectionId } },
          }),
        ),
        config,
      );
    });
  connection
    .command("repos")
    .argument("<connection-id>")
    .action(async (connectionId) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.GET("/connections/{connectionId}/repositories", {
            params: { path: { connectionId } },
          }),
        ),
        config,
      );
    });
  connection
    .command("import")
    .argument("<connection-id>")
    .requiredOption("--repository-id <id>")
    .requiredOption("--account-scope <scope>")
    .option("--name <name>")
    .option("--description <description>", "project description", "")
    .action(async (connectionId, options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.POST("/connections/{connectionId}/import", {
            params: { path: { connectionId } },
            body: compact({
              repositoryId: options.repositoryId,
              accountScope: options.accountScope,
              name: options.name,
              description: options.description,
            }),
          }),
        ),
        config,
      );
    });
  connection
    .command("revoke")
    .argument("<connection-id>")
    .action(async (connectionId) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.POST("/connections/{connectionId}/revoke", { params: { path: { connectionId } } }),
        ),
        config,
      );
    });
}

function addAgentProfileCommands(
  program: Command,
  context: () => { config: CliConfig; client: ReturnType<typeof createApiClient> },
  emit: (value: unknown, config: CliConfig) => void,
): void {
  const profile = program.command("agent-profile").description("Manage Codex Agent Profiles");
  profile.command("list").action(async () => {
    const { config, client } = context();
    emit(await unwrap(client.GET("/agent-profiles")), config);
  });
  profile
    .command("models")
    .requiredOption("--auth-mode <mode>", "api_key or chatgpt_session")
    .requiredOption("--credential-reference <reference>")
    .action(async (options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.POST("/agent-profiles/model-catalog", {
            body: {
              authMode: options.authMode,
              credentialReference: options.credentialReference,
            },
          }),
        ),
        config,
      );
    });
  profile
    .command("create")
    .requiredOption("--name <name>")
    .requiredOption("--auth-mode <mode>", "api_key or chatgpt_session")
    .requiredOption("--credential-reference <env>")
    .requiredOption("--model <model>")
    .requiredOption("--reasoning-effort <effort>")
    .action(async (options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.POST("/agent-profiles", {
            body: compact({
              name: options.name,
              runtime: "codex",
              authMode: options.authMode,
              credentialReference: options.credentialReference,
              model: options.model,
              reasoningEffort: options.reasoningEffort,
            }),
          }),
        ),
        config,
      );
    });
  for (const [action, enabled] of [
    ["enable", true],
    ["disable", false],
  ] as const) {
    profile
      .command(action)
      .argument("<agent-profile-id>")
      .action(async (agentProfileId) => {
        const { config, client } = context();
        emit(
          await unwrap(
            client.PATCH("/agent-profiles/{agentProfileId}/enabled", {
              params: { path: { agentProfileId } },
              body: { enabled },
            }),
          ),
          config,
        );
      });
  }
}

function addRunCommands(
  program: Command,
  context: () => { config: CliConfig; client: ReturnType<typeof createApiClient> },
  emit: (value: unknown, config: CliConfig) => void,
): void {
  const run = program.command("run").description("Inspect and control automated Runs");
  run
    .command("list")
    .requiredOption("--task <task-id>")
    .option("--kind <kind>", "curation or implementation")
    .action(async (options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.GET("/tasks/{taskId}/runs", {
            params: {
              path: { taskId: options.task },
              query: compact({ kind: options.kind }),
            },
          }),
        ),
        config,
      );
    });
  run
    .command("show")
    .argument("<run-id>")
    .action(async (runId) => {
      const { config, client } = context();
      emit(await unwrap(client.GET("/runs/{runId}", { params: { path: { runId } } })), config);
    });
  run
    .command("retry")
    .argument("<run-id>")
    .requiredOption("--expected-version <number>", "expected Task version", positiveInteger)
    .option("--mode <mode>", "auto, full, or publish_only", "auto")
    .action(async (runId, options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.POST("/runs/{runId}/retry", {
            params: { path: { runId }, header: { "If-Match": `"${options.expectedVersion}"` } },
            body: { mode: options.mode },
          }),
        ),
        config,
      );
    });
  run
    .command("cancel")
    .argument("<run-id>")
    .requiredOption("--expected-version <number>", "expected Task version", positiveInteger)
    .requiredOption("--reason <reason>")
    .action(async (runId, options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.POST("/runs/{runId}/cancel", {
            params: { path: { runId }, header: { "If-Match": `"${options.expectedVersion}"` } },
            body: { reason: options.reason },
          }),
        ),
        config,
      );
    });
}

function addRunnerCommands(
  program: Command,
  context: () => { config: CliConfig; client: ReturnType<typeof createApiClient> },
  emit: (value: unknown, config: CliConfig) => void,
): void {
  const runner = program.command("runner").description("Inspect runner-manager availability");
  runner.command("status").action(async () => {
    const { config, client } = context();
    emit(await unwrap(client.GET("/system/runner")), config);
  });
}

export async function runCli(
  argv: readonly string[],
  dependencies: ProgramDependencies = {},
): Promise<number> {
  const io = dependencies.io ?? processIo;
  const program = createProgram(dependencies);
  try {
    await program.parseAsync([...argv]);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") return 0;
      if (program.opts().json) {
        writeError(io, { code: "invalid_input", message: error.message }, true);
      }
      return 2;
    }
    if (error instanceof DoctorExit) return error.exitCode;
    const json = Boolean(program.opts().json);
    if (error instanceof PartialCliError) {
      if (json) {
        io.stderr(
          `${JSON.stringify({ ok: false, partial: true, task: error.task, file: error.file, error: error.apiError })}\n`,
        );
      } else {
        io.stderr(
          `Attachment failed after Task creation: ${error.file}: ${error.apiError.message}\n`,
        );
      }
      return 9;
    }
    if (error instanceof LocalCliError) {
      writeError(io, { ...error, message: error.message }, json);
      return error.exitCode;
    }
    let token = typeof program.opts().token === "string" ? program.opts().token : undefined;
    try {
      token ??= resolveConfig(
        program.opts(),
        dependencies.environment ?? process.env,
        dependencies.configPaths ?? configPaths(dependencies.environment ?? process.env),
      ).token;
    } catch {
      // Preserve the original failure while still redacting any resolvable persistent token.
    }
    const message = sanitize(
      error instanceof Error ? error.message : "Network request failed.",
      token,
    );
    writeError(io, { code: "network_error", message }, json);
    return 7;
  }
}

function addProjectCommands(
  program: Command,
  context: () => { config: CliConfig; client: ReturnType<typeof createApiClient> },
  emit: (value: unknown, config: CliConfig) => void,
): void {
  const project = program.command("project").description("Manage projects");

  project
    .command("create")
    .requiredOption("--name <name>")
    .option("--description <description>", "project description", "")
    .requiredOption("--repository-path <path>")
    .requiredOption("--git-provider <provider>")
    .requiredOption("--account-scope <scope>")
    .action(async (options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.POST("/projects", {
            body: {
              name: options.name,
              description: options.description,
              repositoryPath: options.repositoryPath,
              gitProvider: options.gitProvider,
              accountScope: options.accountScope,
            },
          }),
        ),
        config,
      );
    });

  project
    .command("list")
    .option("--git-provider <provider>")
    .option("--account-scope <scope>")
    .option("--archived")
    .option("--limit <number>", "page size", positiveInteger, 50)
    .option("--cursor <cursor>")
    .action(async (options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.GET("/projects", {
            params: {
              query: compact({
                gitProvider: options.gitProvider,
                accountScope: options.accountScope,
                archived: options.archived || undefined,
                limit: options.limit,
                cursor: options.cursor,
              }),
            },
          }),
        ),
        config,
      );
    });

  project
    .command("show")
    .argument("<project-id>")
    .action(async (projectId) => {
      const { config, client } = context();
      emit(
        await unwrap(client.GET("/projects/{projectId}", { params: { path: { projectId } } })),
        config,
      );
    });

  project
    .command("branches")
    .argument("<project-id>")
    .action(async (projectId) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.GET("/projects/{projectId}/branches", {
            params: { path: { projectId } },
          }),
        ),
        config,
      );
    });

  project
    .command("update")
    .argument("<project-id>")
    .option("--name <name>")
    .option("--description <description>")
    .option("--repository-path <path>")
    .option("--git-provider <provider>")
    .option("--account-scope <scope>")
    .option("--default-branch <branch>")
    .addOption(new Option("--curation-agent-profile <id>").conflicts("clearCurationAgentProfile"))
    .addOption(new Option("--clear-curation-agent-profile").conflicts("curationAgentProfile"))
    .addOption(
      new Option("--implementation-agent-profile <id>").conflicts(
        "clearImplementationAgentProfile",
      ),
    )
    .addOption(
      new Option("--clear-implementation-agent-profile").conflicts("implementationAgentProfile"),
    )
    .addOption(new Option("--enable-automation").conflicts("disableAutomation"))
    .addOption(new Option("--disable-automation").conflicts("enableAutomation"))
    .addOption(new Option("--schedule-cron <expression>").conflicts("clearSchedule"))
    .addOption(new Option("--clear-schedule").conflicts("scheduleCron"))
    .option("--schedule-timezone <timezone>")
    .option("--max-concurrency <number>", "maximum concurrent Runs (1..16)", boundedConcurrency)
    .action(async (projectId, options) => {
      const body = {
        ...compact({
          name: options.name,
          description: options.description,
          repositoryPath: options.repositoryPath,
          gitProvider: options.gitProvider,
          accountScope: options.accountScope,
          defaultBranch: options.defaultBranch,
          scheduleTimezone: options.scheduleTimezone,
          maxConcurrency: options.maxConcurrency,
        }),
        ...(options.clearCurationAgentProfile
          ? { curationAgentProfileId: null }
          : options.curationAgentProfile === undefined
            ? {}
            : { curationAgentProfileId: options.curationAgentProfile }),
        ...(options.clearImplementationAgentProfile
          ? { implementationAgentProfileId: null }
          : options.implementationAgentProfile === undefined
            ? {}
            : { implementationAgentProfileId: options.implementationAgentProfile }),
        ...(options.enableAutomation
          ? { automationEnabled: true }
          : options.disableAutomation
            ? { automationEnabled: false }
            : {}),
        ...(options.clearSchedule
          ? { scheduleCron: null }
          : options.scheduleCron === undefined
            ? {}
            : { scheduleCron: options.scheduleCron }),
      };
      requireFields(body);
      const { config, client } = context();
      emit(
        await unwrap(
          client.PATCH("/projects/{projectId}", { params: { path: { projectId } }, body }),
        ),
        config,
      );
    });

  for (const action of ["archive", "unarchive"] as const) {
    project
      .command(action)
      .argument("<project-id>")
      .action(async (projectId) => {
        const { config, client } = context();
        const path =
          action === "archive"
            ? "/projects/{projectId}/archive"
            : "/projects/{projectId}/unarchive";
        emit(await unwrap(client.POST(path, { params: { path: { projectId } } })), config);
      });
  }
}

function addTaskCommands(
  program: Command,
  context: () => { config: CliConfig; client: ReturnType<typeof createApiClient> },
  emit: (value: unknown, config: CliConfig) => void,
  io: CliIo,
  injectedFetch: typeof globalThis.fetch | undefined,
): void {
  const task = program.command("task").description("Manage tasks");

  task
    .command("create")
    .requiredOption("--project <project-id>")
    .option("--title <title>")
    .option("--base-branch <branch>")
    .option("--request <text>")
    .option("--request-file <path>")
    .option("--attach <path>", "attachment path", collect, [])
    .action(async (options) => {
      const { config, client } = context();
      const userRequest = await readTextInput(options.request, options.requestFile, "request", io);
      const created = await unwrap(
        client.POST("/tasks", {
          body: compact({
            projectId: options.project,
            title: options.title,
            userRequest,
            baseBranch: options.baseBranch,
          }),
        }),
      );
      let aggregate = created;
      for (const path of options.attach as string[]) {
        try {
          await upload(config, aggregate.id, aggregate.version, path, injectedFetch);
          aggregate = await unwrap(
            client.GET("/tasks/{taskId}", { params: { path: { taskId: aggregate.id } } }),
          );
        } catch (error) {
          const cause = normalizeError(error);
          throw new PartialCliError(aggregate, path, cause);
        }
      }
      emit(aggregate, config);
    });

  task
    .command("list")
    .option("--project <project-id>")
    .option("--status <status>", "task status", collect, [])
    .option("--account-scope <scope>")
    .option("--git-provider <provider>")
    .option("--archived")
    .option("--sort <field>", "updated-at or created-at", "updated-at")
    .option("--order <order>", "asc or desc", "desc")
    .option("--limit <number>", "page size", positiveInteger, 50)
    .option("--cursor <cursor>")
    .action(async (options) => {
      const { config, client } = context();
      const sort =
        options.sort === "created-at"
          ? "createdAt"
          : options.sort === "updated-at"
            ? "updatedAt"
            : options.sort;
      emit(
        await unwrap(
          client.GET("/tasks", {
            params: {
              query: compact({
                projectId: options.project,
                status: options.status.length === 0 ? undefined : options.status,
                accountScope: options.accountScope,
                gitProvider: options.gitProvider,
                archived: options.archived || undefined,
                sort,
                order: options.order,
                limit: options.limit,
                cursor: options.cursor,
              }),
            },
          }),
        ),
        config,
      );
    });

  task
    .command("show")
    .argument("<task-id>")
    .action(async (taskId) => {
      const { config, client } = context();
      emit(await unwrap(client.GET("/tasks/{taskId}", { params: { path: { taskId } } })), config);
    });

  task
    .command("update")
    .argument("<task-id>")
    .requiredOption("--expected-version <number>", "expected Task version", positiveInteger)
    .option("--title <title>")
    .addOption(new Option("--request <text>").conflicts("requestFile"))
    .addOption(new Option("--request-file <path>").conflicts("request"))
    .option("--spec <text>")
    .option("--spec-file <path>")
    .addOption(new Option("--pr-url <url>").conflicts("clearPrUrl"))
    .addOption(new Option("--clear-pr-url").conflicts("prUrl"))
    .action(async (taskId, options) => {
      const curatorSpec =
        options.spec === undefined && options.specFile === undefined
          ? undefined
          : await readTextInput(options.spec, options.specFile, "spec", io);
      const userRequest =
        options.request === undefined && options.requestFile === undefined
          ? undefined
          : await readTextInput(options.request, options.requestFile, "request", io);
      const body = {
        ...(options.title === undefined ? {} : { title: options.title }),
        ...(userRequest === undefined ? {} : { userRequest }),
        ...(curatorSpec === undefined ? {} : { curatorSpec }),
        ...(options.clearPrUrl
          ? { prUrl: null }
          : options.prUrl === undefined
            ? {}
            : { prUrl: options.prUrl }),
      };
      requireFields(body);
      const { config, client } = context();
      emit(
        await unwrap(
          client.PATCH("/tasks/{taskId}", {
            params: { path: { taskId }, header: { "If-Match": `"${options.expectedVersion}"` } },
            body,
          }),
        ),
        config,
      );
    });

  task
    .command("transition")
    .argument("<task-id>")
    .requiredOption("--from <status>")
    .requiredOption("--to <status>")
    .requiredOption("--expected-version <number>", "expected Task version", positiveInteger)
    .option("--reason <text>")
    .action(async (taskId, options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.POST("/tasks/{taskId}/transition", {
            params: { path: { taskId }, header: { "If-Match": `"${options.expectedVersion}"` } },
            body: compact({ from: options.from, to: options.to, reason: options.reason }),
          }),
        ),
        config,
      );
    });

  task
    .command("automation-resume")
    .argument("<task-id>")
    .requiredOption("--expected-version <number>", "expected Task version", positiveInteger)
    .action(async (taskId, options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.POST("/tasks/{taskId}/automation/resume", {
            params: { path: { taskId }, header: { "If-Match": `"${options.expectedVersion}"` } },
          }),
        ),
        config,
      );
    });

  addTaskArchiveCommands(task, context, emit);
  addQuestionCommands(task, context, emit, io);
  addAttachmentCommands(task, context, emit, io, injectedFetch);

  task
    .command("message")
    .argument("<task-id>")
    .requiredOption("--expected-version <number>", "expected Task version", positiveInteger)
    .addOption(new Option("--text <text>").conflicts("textFile"))
    .addOption(new Option("--text-file <path>").conflicts("text"))
    .option("--attach <path>", "attachment path", collect, [])
    .action(async (taskId, options) => {
      const { config } = context();
      const text =
        options.text === undefined && options.textFile === undefined
          ? undefined
          : await readTextInput(options.text, options.textFile, "text", io);
      emit(
        await sendMessage(
          config,
          taskId,
          options.expectedVersion,
          text,
          options.attach,
          injectedFetch,
        ),
        config,
      );
    });

  task
    .command("timeline")
    .argument("<task-id>")
    .option("--limit <number>", "page size", positiveInteger, 50)
    .option("--cursor <cursor>")
    .action(async (taskId, options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.GET("/tasks/{taskId}/timeline", {
            params: {
              path: { taskId },
              query: compact({ limit: options.limit, cursor: options.cursor }),
            },
          }),
        ),
        config,
      );
    });

  task
    .command("activity")
    .argument("<task-id>")
    .option("--limit <number>", "page size", positiveInteger, 50)
    .option("--cursor <cursor>")
    .action(async (taskId, options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.GET("/tasks/{taskId}/activity", {
            params: {
              path: { taskId },
              query: compact({ limit: options.limit, cursor: options.cursor }),
            },
          }),
        ),
        config,
      );
    });
}

function addTaskArchiveCommands(
  task: Command,
  context: () => { config: CliConfig; client: ReturnType<typeof createApiClient> },
  emit: (value: unknown, config: CliConfig) => void,
): void {
  task
    .command("archive")
    .argument("<task-id>")
    .requiredOption("--expected-version <number>", "expected Task version", positiveInteger)
    .option("--reason <text>")
    .action(async (taskId, options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.POST("/tasks/{taskId}/archive", {
            params: { path: { taskId }, header: { "If-Match": `"${options.expectedVersion}"` } },
            body: compact({ reason: options.reason }),
          }),
        ),
        config,
      );
    });
  task
    .command("unarchive")
    .argument("<task-id>")
    .requiredOption("--expected-version <number>", "expected Task version", positiveInteger)
    .action(async (taskId, options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.POST("/tasks/{taskId}/unarchive", {
            params: { path: { taskId }, header: { "If-Match": `"${options.expectedVersion}"` } },
          }),
        ),
        config,
      );
    });
}

function addQuestionCommands(
  task: Command,
  context: () => { config: CliConfig; client: ReturnType<typeof createApiClient> },
  emit: (value: unknown, config: CliConfig) => void,
  io: CliIo,
): void {
  const question = task.command("question").description("Manage Task questions");
  const definition = (command: Command): Command =>
    command
      .requiredOption("--expected-version <number>", "expected Task version", positiveInteger)
      .requiredOption("--type <type>")
      .requiredOption("--text <text>")
      .option("--option <label>", "choice label", collect, [])
      .option("--allow-other");

  definition(question.command("create").argument("<task-id>")).action(async (taskId, options) => {
    const { config, client } = context();
    emit(
      await unwrap(
        client.POST("/tasks/{taskId}/questions", {
          params: { path: { taskId }, header: { "If-Match": `"${options.expectedVersion}"` } },
          body: questionDefinition(options),
        }),
      ),
      config,
    );
  });

  question
    .command("list")
    .argument("<task-id>")
    .action(async (taskId) => {
      const { config, client } = context();
      emit(
        await unwrap(client.GET("/tasks/{taskId}/questions", { params: { path: { taskId } } })),
        config,
      );
    });

  question
    .command("show")
    .argument("<task-id>")
    .argument("<question-id>")
    .action(async (taskId, questionId) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.GET("/tasks/{taskId}/questions/{questionId}", {
            params: { path: { taskId, questionId } },
          }),
        ),
        config,
      );
    });

  definition(question.command("update").argument("<task-id>").argument("<question-id>")).action(
    async (taskId, questionId, options) => {
      const { config, client } = context();
      emit(
        await unwrap(
          client.PATCH("/tasks/{taskId}/questions/{questionId}", {
            params: {
              path: { taskId, questionId },
              header: { "If-Match": `"${options.expectedVersion}"` },
            },
            body: questionDefinition(options),
          }),
        ),
        config,
      );
    },
  );

  question
    .command("answer")
    .argument("<task-id>")
    .argument("<question-id>")
    .requiredOption("--expected-version <number>", "expected Task version", positiveInteger)
    .option("--option-id <option-id>", "selected option ID", collect, [])
    .option("--text <text>")
    .option("--text-file <path>")
    .action(async (taskId, questionId, options) => {
      const answerText =
        options.text === undefined && options.textFile === undefined
          ? null
          : await readTextInput(options.text, options.textFile, "text", io);
      const { config, client } = context();
      emit(
        await unwrap(
          client.POST("/tasks/{taskId}/questions/{questionId}/answer", {
            params: {
              path: { taskId, questionId },
              header: { "If-Match": `"${options.expectedVersion}"` },
            },
            body: { selectedOptionIds: options.optionId, answerText },
          }),
        ),
        config,
      );
    });

  for (const action of ["dismiss", "reopen"] as const) {
    question
      .command(action)
      .argument("<task-id>")
      .argument("<question-id>")
      .requiredOption("--expected-version <number>", "expected Task version", positiveInteger)
      .option("--reason <text>")
      .action(async (taskId, questionId, options) => {
        const { config, client } = context();
        const path =
          action === "dismiss"
            ? "/tasks/{taskId}/questions/{questionId}/dismiss"
            : "/tasks/{taskId}/questions/{questionId}/reopen";
        emit(
          await unwrap(
            client.POST(path, {
              params: {
                path: { taskId, questionId },
                header: { "If-Match": `"${options.expectedVersion}"` },
              },
              body: compact({ reason: options.reason }),
            }),
          ),
          config,
        );
      });
  }
}

function addAttachmentCommands(
  task: Command,
  context: () => { config: CliConfig; client: ReturnType<typeof createApiClient> },
  emit: (value: unknown, config: CliConfig) => void,
  io: CliIo,
  injectedFetch: typeof globalThis.fetch | undefined,
): void {
  const attachment = task.command("attachment").description("Manage Task attachments");

  attachment
    .command("add")
    .argument("<task-id>")
    .argument("<path>")
    .requiredOption("--expected-version <number>", "expected Task version", positiveInteger)
    .action(async (taskId, path, options) => {
      const { config } = context();
      emit(await upload(config, taskId, options.expectedVersion, path, injectedFetch), config);
    });

  attachment
    .command("list")
    .argument("<task-id>")
    .action(async (taskId) => {
      const { config, client } = context();
      emit(
        await unwrap(client.GET("/tasks/{taskId}/attachments", { params: { path: { taskId } } })),
        config,
      );
    });

  attachment
    .command("get")
    .argument("<task-id>")
    .argument("<attachment-id>")
    .requiredOption("--output <path>")
    .option("--force")
    .action(async (taskId, attachmentId, options) => {
      const { config } = context();
      if (options.output === "-" && config.json) {
        throw new LocalCliError("invalid_input", "--output - cannot be combined with --json.", 2);
      }
      await download(
        config,
        taskId,
        attachmentId,
        options.output,
        options.force ?? false,
        io,
        injectedFetch,
      );
      if (options.output !== "-") emit({ ok: true }, config);
    });

  attachment
    .command("delete")
    .argument("<task-id>")
    .argument("<attachment-id>")
    .requiredOption("--expected-version <number>", "expected Task version", positiveInteger)
    .option("--yes")
    .action(async (taskId, attachmentId, options) => {
      const { config, client } = context();
      if (!options.yes) {
        if (config.json) {
          throw new LocalCliError("confirmation_required", "--yes is required with --json.", 2);
        }
        if (!(await io.confirm(`Delete attachment ${attachmentId}?`))) return;
      }
      emit(
        await unwrap(
          client.DELETE("/tasks/{taskId}/attachments/{attachmentId}", {
            params: {
              path: { taskId, attachmentId },
              header: { "If-Match": `"${options.expectedVersion}"` },
            },
          }),
        ),
        config,
      );
    });
}

function questionDefinition(options: {
  type: string;
  text: string;
  option: string[];
  allowOther?: boolean;
}) {
  const type = options.type.replaceAll("-", "_");
  if (type !== "text" && type !== "single_choice" && type !== "multiple_choice") {
    throw new LocalCliError("invalid_input", "Question type is invalid.", 2);
  }
  const validType: "text" | "single_choice" | "multiple_choice" = type;
  return {
    text: options.text,
    type: validType,
    options: options.option.map((label) => ({ label })),
    allowOther: options.allowOther ?? false,
  };
}

async function upload(
  config: CliConfig,
  taskId: string,
  expectedVersion: number,
  path: string,
  injectedFetch?: typeof globalThis.fetch,
): Promise<unknown> {
  let file: Bun.BunFile;
  try {
    file = Bun.file(path);
    if (!(await file.exists())) throw new Error("Missing file");
  } catch {
    throw new LocalCliError("file_read_error", "Could not read attachment file.", 8, { path });
  }
  const name = path.replaceAll("\\", "/").split("/").at(-1) ?? path;
  const form = new FormData();
  form.set("file", file, name);
  const response = await (injectedFetch ?? globalThis.fetch)(
    `${apiBaseUrl(config.apiUrl)}/tasks/${encodeURIComponent(taskId)}/attachments`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "If-Match": `"${expectedVersion}"` },
      body: form,
      signal: AbortSignal.timeout(config.transferTimeoutMs),
    },
  );
  return responseJson(response);
}

async function sendMessage(
  config: CliConfig,
  taskId: string,
  expectedVersion: number,
  text: string | undefined,
  paths: readonly string[],
  injectedFetch?: typeof globalThis.fetch,
): Promise<unknown> {
  const form = new FormData();
  if (text !== undefined) form.set("text", text);
  for (const path of paths) {
    const file = Bun.file(path);
    if (!(await file.exists()))
      throw new LocalCliError("file_read_error", "Could not read message attachment.", 8, { path });
    form.append("file", file, path.replaceAll("\\", "/").split("/").at(-1) ?? path);
  }
  const response = await (injectedFetch ?? globalThis.fetch)(
    `${apiBaseUrl(config.apiUrl)}/tasks/${encodeURIComponent(taskId)}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "If-Match": `"${expectedVersion}"` },
      body: form,
      signal: AbortSignal.timeout(config.transferTimeoutMs),
    },
  );
  return responseJson(response);
}

async function download(
  config: CliConfig,
  taskId: string,
  attachmentId: string,
  output: string,
  force: boolean,
  io: CliIo,
  injectedFetch?: typeof globalThis.fetch,
): Promise<void> {
  if (output !== "-" && !force && (await Bun.file(output).exists())) {
    throw new LocalCliError("file_exists", "Output file already exists.", 8, { path: output });
  }
  const response = await (injectedFetch ?? globalThis.fetch)(
    `${apiBaseUrl(config.apiUrl)}/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}/content`,
    {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(config.transferTimeoutMs),
    },
  );
  if (!response.ok) await responseJson(response);
  if (output === "-") {
    io.stdoutBytes(new Uint8Array(await response.arrayBuffer()));
    return;
  }
  const temporary = `${output}.aiws-${crypto.randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, response);
    await rename(temporary, output);
  } catch {
    try {
      await unlink(temporary);
    } catch {
      // Best-effort cleanup of a local temporary download.
    }
    throw new LocalCliError("file_write_error", "Could not write downloaded attachment.", 8, {
      path: output,
    });
  }
}

async function responseJson(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => undefined);
  if (response.ok) return body;
  throw apiFailure(response.status, body);
}

async function unwrap<T>(resultPromise: ApiResult<T>): Promise<T> {
  const result = await resultPromise;
  if (result.data !== undefined) return result.data;
  throw apiFailure(result.response.status, result.error);
}

function apiFailure(status: number, value: unknown): LocalCliError {
  const envelope = isRecord(value) && isRecord(value.error) ? value.error : {};
  return new LocalCliError(
    typeof envelope.code === "string" ? envelope.code : "api_error",
    typeof envelope.message === "string"
      ? envelope.message
      : `API request failed with HTTP ${status}.`,
    exitCodeForStatus(status),
    isRecord(envelope.details) ? envelope.details : {},
    typeof envelope.requestId === "string" ? envelope.requestId : null,
  );
}

function exitCodeForStatus(status: number): number {
  if (status === 401 || status === 403) return 3;
  if (status === 404) return 4;
  if (status === 409 || status === 428) return 5;
  if (status === 400 || status === 413 || status === 415 || status === 422) return 2;
  return status >= 500 ? 6 : 6;
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new InvalidArgumentError("must be a positive integer");
  return parsed;
}

function boundedConcurrency(value: string): number {
  const parsed = positiveInteger(value);
  if (parsed > 16) throw new InvalidArgumentError("must be between 1 and 16");
  return parsed;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function requireFields(value: Readonly<Record<string, unknown>>): void {
  if (Object.keys(value).length === 0) {
    throw new LocalCliError("invalid_input", "At least one field is required.", 2);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeError(error: unknown): {
  code: string;
  message: string;
  details: unknown;
  requestId: string | null;
} {
  if (error instanceof LocalCliError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      requestId: error.requestId,
    };
  }
  return {
    code: "network_error",
    message: error instanceof Error ? error.message : "Network request failed.",
    details: {},
    requestId: null,
  };
}

function sanitize(message: string, token: string | undefined): string {
  return token === undefined || token.length === 0
    ? message
    : message.replaceAll(token, "[REDACTED]");
}
