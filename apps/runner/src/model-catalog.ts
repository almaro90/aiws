import type { CredentialProxy } from "./credential-proxy.ts";

export type CatalogAuthMode = "api_key" | "chatgpt_session";

export interface CatalogModel {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isDefault: boolean;
  readonly defaultReasoningEffort: string;
  readonly supportedReasoningEfforts: readonly string[];
}

export interface ModelCatalog {
  readonly models: readonly CatalogModel[];
}

interface AppServerModel {
  readonly id?: unknown;
  readonly displayName?: unknown;
  readonly description?: unknown;
  readonly isDefault?: unknown;
  readonly defaultReasoningEffort?: unknown;
  readonly supportedReasoningEfforts?: unknown;
}

interface RpcResponse {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

export class CodexModelCatalog {
  private readonly cache = new Map<
    string,
    { readonly expiresAt: number; readonly catalog: ModelCatalog }
  >();

  constructor(
    private readonly image: string,
    private readonly network: string,
    private readonly proxy: CredentialProxy,
    private readonly proxyUrl: string,
    private readonly chatgptVolume: string,
    private readonly now: () => number = Date.now,
  ) {}

  async list(authMode: CatalogAuthMode, credentialReference: string): Promise<ModelCatalog> {
    const cacheKey = `${authMode}:${credentialReference}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > this.now()) return cached.catalog;

    const catalog = await this.load(authMode, credentialReference);
    this.cache.set(cacheKey, { expiresAt: this.now() + CACHE_TTL_MS, catalog });
    return catalog;
  }

  private async load(
    authMode: CatalogAuthMode,
    credentialReference: string,
  ): Promise<ModelCatalog> {
    const containerName = `aiws-model-catalog-${crypto.randomUUID().replaceAll("-", "")}`;
    const args = catalogDockerArguments(containerName, this.network);
    let capability: string | null = null;
    if (authMode === "api_key") {
      const secret = Bun.env[credentialReference];
      if (!secret) throw new Error("The requested agent credential is not configured.");
      capability = this.proxy.grant(secret);
      args.push(
        "--tmpfs",
        "/codex-home:rw,noexec,nosuid,nodev",
        "-e",
        "CODEX_HOME=/codex-home",
        "-e",
        `CODEX_API_KEY=${capability}`,
      );
    } else {
      args.push(
        "-e",
        "CODEX_HOME=/codex-home",
        "--mount",
        `type=volume,src=${this.chatgptVolume},dst=/codex-home`,
      );
    }
    args.push(this.image, "codex", "app-server", "--stdio");
    if (capability !== null) args.push("-c", `openai_base_url="${this.proxyUrl}"`);

    let process: ReturnType<typeof Bun.spawn> | undefined;
    try {
      process = Bun.spawn(args, {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "ignore",
        env: { PATH: Bun.env.PATH ?? "/usr/bin:/bin" },
      });
      return await withTimeout(this.readAppServer(process), REQUEST_TIMEOUT_MS);
    } finally {
      process?.kill();
      await process?.exited.catch(() => undefined);
      if (capability !== null) this.proxy.revoke(capability);
      if (process !== undefined) {
        const cleanup = Bun.spawn(["docker", "rm", "-f", containerName], {
          stdout: "ignore",
          stderr: "ignore",
        });
        await cleanup.exited;
      }
    }
  }

  async readAppServer(process: ReturnType<typeof Bun.spawn>): Promise<ModelCatalog> {
    const stdin = process.stdin;
    if (
      !(process.stdout instanceof ReadableStream) ||
      typeof stdin !== "object" ||
      stdin === null
    ) {
      throw new Error("Codex app-server stdio is unavailable.");
    }
    const reader = new JsonLineReader(process.stdout);
    const request = async (id: number, method: string, params: unknown): Promise<unknown> => {
      stdin.write(`${JSON.stringify({ method, id, params })}\n`);
      await stdin.flush();
      for (;;) {
        const response = (await reader.next()) as RpcResponse;
        if (response.id !== id) continue;
        if (response.error !== undefined) throw new Error("Codex app-server request failed.");
        return response.result;
      }
    };

    await request(1, "initialize", {
      clientInfo: { name: "aiws", title: "AIWS", version: "0.8.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
    await stdin.flush();

    const models: CatalogModel[] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const result = await request(page + 2, "model/list", {
        cursor,
        limit: 100,
        includeHidden: false,
      });
      if (!isRecord(result) || !Array.isArray(result.data)) {
        throw new Error("Codex returned a malformed model catalog.");
      }
      models.push(...result.data.map(normalizeModel));
      const nextCursor = result.nextCursor;
      if (nextCursor === null) break;
      if (typeof nextCursor !== "string" || cursors.has(nextCursor)) {
        throw new Error("Codex returned an invalid model catalog cursor.");
      }
      cursors.add(nextCursor);
      cursor = nextCursor;
    }
    if (models.length === 0) throw new Error("Codex returned an empty model catalog.");
    if (new Set(models.map((model) => model.id)).size !== models.length) {
      throw new Error("Codex returned duplicate model identifiers.");
    }
    return { models };
  }
}

export function catalogDockerArguments(containerName: string, network: string): string[] {
  return [
    "docker",
    "run",
    "--rm",
    "-i",
    "--name",
    containerName,
    "--network",
    network,
    "--cpus",
    "1",
    "--memory",
    "1g",
    "--pids-limit",
    "128",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
  ];
}

class JsonLineReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = "";

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  async next(): Promise<unknown> {
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line.length === 0) continue;
        try {
          return JSON.parse(line);
        } catch {
          throw new Error("Codex app-server returned invalid JSON.");
        }
      }
      const chunk = await this.reader.read();
      if (chunk.done) throw new Error("Codex app-server exited before returning the catalog.");
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }
}

function normalizeModel(value: unknown): CatalogModel {
  if (!isRecord(value)) throw new Error("Codex returned a malformed model.");
  const model = value as AppServerModel;
  if (
    typeof model.id !== "string" ||
    model.id.trim() === "" ||
    model.id.length > 120 ||
    typeof model.displayName !== "string" ||
    typeof model.description !== "string" ||
    typeof model.isDefault !== "boolean" ||
    typeof model.defaultReasoningEffort !== "string" ||
    !Array.isArray(model.supportedReasoningEfforts)
  ) {
    throw new Error("Codex returned a malformed model.");
  }
  const supportedReasoningEfforts = model.supportedReasoningEfforts.map((option) => {
    if (
      !isRecord(option) ||
      typeof option.reasoningEffort !== "string" ||
      option.reasoningEffort.trim() === "" ||
      option.reasoningEffort.length > 120
    ) {
      throw new Error("Codex returned a malformed reasoning effort.");
    }
    return option.reasoningEffort;
  });
  if (
    supportedReasoningEfforts.length === 0 ||
    new Set(supportedReasoningEfforts).size !== supportedReasoningEfforts.length ||
    model.defaultReasoningEffort.length > 120 ||
    !supportedReasoningEfforts.includes(model.defaultReasoningEffort)
  ) {
    throw new Error("Codex returned inconsistent reasoning efforts.");
  }
  return {
    id: model.id,
    name: model.displayName,
    description: model.description,
    isDefault: model.isDefault,
    defaultReasoningEffort: model.defaultReasoningEffort,
    supportedReasoningEfforts,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Codex model catalog request timed out.")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
