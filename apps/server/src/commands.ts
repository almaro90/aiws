import { createHash, randomBytes } from "node:crypto";
import { loadConfig } from "./config.ts";

export interface CommandIo {
  readonly stdin: AsyncIterable<string | Uint8Array> & {
    readonly isTTY?: boolean;
    setEncoding?: (encoding: BufferEncoding) => unknown;
    setRawMode?: (mode: boolean) => unknown;
    resume?: () => unknown;
    pause?: () => unknown;
    on?: (event: "data", listener: (chunk: string) => void) => unknown;
    off?: (event: "data", listener: (chunk: string) => void) => unknown;
  };
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

const processIo: CommandIo = {
  stdin: process.stdin,
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

export async function runServerCommand(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
  io: CommandIo = processIo,
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  const standaloneCommand = argv[1];
  const command =
    argv[2] ??
    (standaloneCommand !== undefined && operationalCommands.has(standaloneCommand)
      ? standaloneCommand
      : undefined);
  if (command === undefined) return null;

  if (command === "hash-password") {
    const password = await readPassword(io);
    if (password.length === 0) throw new Error("Password must not be empty.");
    const hash = await Bun.password.hash(password, {
      algorithm: "argon2id",
      memoryCost: 65_536,
      timeCost: 3,
    });
    io.stdout(`${hash}\n`);
    return 0;
  }

  if (command === "generate-session-secret") {
    io.stdout(`${randomBytes(32).toString("base64")}\n`);
    return 0;
  }

  if (command === "generate-api-token") {
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    io.stdout(`AIWS_API_TOKEN=${token}\nAIWS_API_TOKEN_HASH=sha256:${hash}\n`);
    return 0;
  }

  if (command === "generate-runner-token") {
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    io.stdout(`AIWS_RUNNER_TOKEN=${token}\nAIWS_RUNNER_TOKEN_HASH=sha256:${hash}\n`);
    return 0;
  }

  if (command === "generate-runner-control-secret") {
    io.stdout(`AIWS_RUNNER_CONTROL_SECRET=${randomBytes(32).toString("base64url")}\n`);
    return 0;
  }

  if (command === "generate-notification-encryption-key") {
    io.stdout(`AIWS_NOTIFICATION_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}\n`);
    return 0;
  }

  if (command === "healthcheck") {
    const config = loadConfig(environment);
    try {
      const response = await fetcher(`http://127.0.0.1:${config.port}/api/v1/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return 1;
      const body = (await response.json()) as { readonly status?: unknown };
      return body.status === "ok" ? 0 : 1;
    } catch {
      return 1;
    }
  }

  io.stderr(`Unknown command: ${command}\n`);
  return 2;
}

const operationalCommands = new Set([
  "hash-password",
  "generate-session-secret",
  "generate-api-token",
  "generate-runner-token",
  "generate-runner-control-secret",
  "generate-notification-encryption-key",
  "healthcheck",
]);

async function readPassword(io: CommandIo): Promise<string> {
  if (!io.stdin.isTTY || typeof io.stdin.setRawMode !== "function") {
    let input = "";
    for await (const chunk of io.stdin) {
      input += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    }
    return input.replace(/[\r\n]+$/u, "");
  }

  io.stderr("Password: ");
  io.stdin.setEncoding?.("utf8");
  io.stdin.setRawMode(true);
  io.stdin.resume?.();
  let password = "";

  try {
    return await new Promise<string>((resolve, reject) => {
      const onData = (chunk: string): void => {
        for (const character of chunk) {
          if (character === "\r" || character === "\n") {
            cleanup();
            io.stderr("\n");
            resolve(password);
          } else if (character === "\u0003") {
            cleanup();
            io.stderr("\n");
            reject(new Error("Password input cancelled."));
          } else if (character === "\u007f" || character === "\b") {
            password = password.slice(0, -1);
          } else {
            password += character;
          }
        }
      };
      const cleanup = (): void => {
        io.stdin.off?.("data", onData);
        io.stdin.setRawMode?.(false);
        io.stdin.pause?.();
      };
      io.stdin.on?.("data", onData);
    });
  } finally {
    io.stdin.setRawMode(false);
  }
}
