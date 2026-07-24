import {
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

export const DEFAULT_API_URL = "http://127.0.0.1:3000";
export const SYSTEM_CONFIG_FILE = "/etc/aiws/config.json";
export const SYSTEM_CONFIG_GROUP = "aiws-agents";

export interface StoredCliConfig {
  readonly apiUrl?: string;
  readonly token?: string;
}

export interface CliConfig {
  readonly apiUrl: string;
  readonly token: string;
  readonly json: boolean;
  readonly httpTimeoutMs: number;
  readonly transferTimeoutMs: number;
}

export interface GlobalOptions {
  readonly apiUrl?: string;
  readonly token?: string;
  readonly json?: boolean;
}

export interface ConfigPaths {
  readonly user: string;
  readonly system: string;
}

export function configPaths(
  environment: Readonly<Record<string, string | undefined>>,
): ConfigPaths {
  const userRoot =
    environment.XDG_CONFIG_HOME ??
    join(
      environment.HOME === undefined || environment.HOME === "" ? homedir() : environment.HOME,
      ".config",
    );
  return {
    user: join(userRoot, "aiws", "config.json"),
    system: SYSTEM_CONFIG_FILE,
  };
}

export function resolveConfig(
  options: GlobalOptions,
  environment: Readonly<Record<string, string | undefined>>,
  paths: ConfigPaths = configPaths(environment),
): CliConfig {
  const stored = loadStoredConfig(environment, paths);
  const token = options.token ?? environment.AIWS_API_TOKEN ?? stored.token;
  if (token === undefined || token.length === 0) {
    throw new LocalCliError("configuration_error", "AIWS API token is required.", 3);
  }
  const apiUrl = options.apiUrl ?? environment.AIWS_API_URL ?? stored.apiUrl ?? DEFAULT_API_URL;
  validateApiUrl(apiUrl);
  return {
    apiUrl,
    token,
    json: options.json ?? false,
    httpTimeoutMs: positiveInteger(environment.AIWS_HTTP_TIMEOUT_MS, 30_000),
    transferTimeoutMs: positiveInteger(environment.AIWS_TRANSFER_TIMEOUT_MS, 300_000),
  };
}

export function resolveDisplayConfig(
  options: GlobalOptions,
  environment: Readonly<Record<string, string | undefined>>,
  paths: ConfigPaths = configPaths(environment),
): { readonly apiUrl: string; readonly token: string | null } {
  const stored = loadStoredConfig(environment, paths);
  const apiUrl = options.apiUrl ?? environment.AIWS_API_URL ?? stored.apiUrl ?? DEFAULT_API_URL;
  validateApiUrl(apiUrl);
  const token = options.token ?? environment.AIWS_API_TOKEN ?? stored.token;
  return { apiUrl, token: token === undefined ? null : "[REDACTED]" };
}

export function readPersistentConfig(path: string, required = false): StoredCliConfig {
  if (!existsSync(path)) {
    if (required) {
      throw new LocalCliError("configuration_error", "AIWS configuration file was not found.", 3);
    }
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(parsed)) throw new Error("not an object");
    const keys = Object.keys(parsed);
    if (keys.some((key) => key !== "apiUrl" && key !== "token")) throw new Error("unknown field");
    const apiUrl = optionalString(parsed.apiUrl);
    const token = optionalString(parsed.token);
    if (apiUrl !== undefined) validateApiUrl(apiUrl);
    if (token !== undefined && token.length === 0) throw new Error("empty token");
    return {
      ...(apiUrl === undefined ? {} : { apiUrl }),
      ...(token === undefined ? {} : { token }),
    };
  } catch (error) {
    if (error instanceof LocalCliError) throw error;
    throw new LocalCliError("configuration_error", "AIWS configuration file is invalid.", 3);
  }
}

export function setPersistentConfig(
  path: string,
  update: StoredCliConfig,
  system: boolean,
): StoredCliConfig {
  if (update.apiUrl === undefined && update.token === undefined) {
    throw new LocalCliError("invalid_input", "At least one configuration value is required.", 2);
  }
  if (update.apiUrl !== undefined) validateApiUrl(update.apiUrl);
  if (update.token !== undefined && update.token.length === 0) {
    throw new LocalCliError("invalid_input", "Token must not be empty.", 2);
  }
  const current = readPersistentConfig(path);
  const next = { ...current, ...update };
  writePersistentConfig(path, next, system);
  return next;
}

export function unsetPersistentConfig(
  path: string,
  fields: readonly ("apiUrl" | "token")[],
  system: boolean,
): StoredCliConfig {
  const current = readPersistentConfig(path);
  const targets = fields.length === 0 ? (["apiUrl", "token"] as const) : fields;
  const next: { apiUrl?: string; token?: string } = { ...current };
  for (const field of targets) delete next[field];
  if (Object.keys(next).length === 0) {
    if (existsSync(path)) unlinkSync(path);
    return {};
  }
  writePersistentConfig(path, next, system);
  return next;
}

function loadStoredConfig(
  environment: Readonly<Record<string, string | undefined>>,
  paths: ConfigPaths,
): StoredCliConfig {
  const system = readPersistentConfig(paths.system);
  const user = readPersistentConfig(paths.user);
  const explicit =
    environment.AIWS_CONFIG_FILE === undefined
      ? {}
      : readPersistentConfig(environment.AIWS_CONFIG_FILE, true);
  return { ...system, ...user, ...explicit };
}

function writePersistentConfig(path: string, value: StoredCliConfig, system: boolean): void {
  if (!isAbsolute(path)) {
    throw new LocalCliError("configuration_error", "Configuration path must be absolute.", 3);
  }
  if (system && typeof process.getuid === "function" && process.getuid() !== 0) {
    throw new LocalCliError(
      "configuration_error",
      "System configuration must be written as root.",
      3,
    );
  }
  const directory = dirname(path);
  const directoryMode = system ? 0o750 : 0o700;
  const fileMode = system ? 0o640 : 0o600;
  try {
    mkdirSync(directory, { recursive: true, mode: directoryMode });
    chmodSync(directory, directoryMode);
    const temporary = join(directory, `.config.json.${process.pid}.${randomUUID()}.tmp`);
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: fileMode,
      flag: "wx",
    });
    chmodSync(temporary, fileMode);
    if (system) {
      const groupId = systemGroupId();
      chownSync(directory, 0, groupId);
      chownSync(temporary, 0, groupId);
    }
    renameSync(temporary, path);
  } catch (error) {
    if (error instanceof LocalCliError) throw error;
    throw new LocalCliError("file_write_error", "Could not write AIWS configuration.", 8);
  }
}

function systemGroupId(): number {
  try {
    const line = readFileSync("/etc/group", "utf8")
      .split("\n")
      .find((entry) => entry.startsWith(`${SYSTEM_CONFIG_GROUP}:`));
    const groupId = Number(line?.split(":")[2]);
    if (!Number.isSafeInteger(groupId) || groupId < 0) throw new Error("group missing");
    return groupId;
  } catch {
    throw new LocalCliError(
      "configuration_error",
      `Unix group ${SYSTEM_CONFIG_GROUP} does not exist.`,
      3,
    );
  }
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("not a string");
  return value;
}

function validateApiUrl(value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
  } catch {
    throw new LocalCliError("configuration_error", "AIWS API URL is invalid.", 3);
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new LocalCliError("configuration_error", "HTTP timeout configuration is invalid.", 3);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class LocalCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: number,
    readonly details: Readonly<Record<string, unknown>> = {},
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "LocalCliError";
  }
}

export class PartialCliError extends LocalCliError {
  constructor(
    readonly task: unknown,
    readonly file: string,
    readonly apiError: {
      code: string;
      message: string;
      details: unknown;
      requestId?: string | null;
    },
  ) {
    super("partial_failure", "Task created but an attachment failed.", 9);
    this.name = "PartialCliError";
  }
}
