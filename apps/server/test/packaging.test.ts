import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import { runServerCommand } from "../src/commands.ts";
import { shutdownServer, type StoppableServer } from "../src/runtime.ts";

describe("Hito 9 operational commands", () => {
  test("generates a session secret with at least 32 random bytes", async () => {
    const output: string[] = [];
    const result = await runServerCommand(
      ["bun", "server.ts", "generate-session-secret"],
      {},
      commandIo(output),
    );

    expect(result).toBe(0);
    expect(Buffer.from(output.join("").trim(), "base64").byteLength).toBeGreaterThanOrEqual(32);
  });

  test("generates an API token together with its matching SHA-256 hash", async () => {
    const output: string[] = [];
    expect(
      await runServerCommand(["/app/aiws-server", "generate-api-token"], {}, commandIo(output)),
    ).toBe(0);
    const values = Object.fromEntries(
      output
        .join("")
        .trim()
        .split("\n")
        .map((line) => line.split("=", 2)),
    );
    const token = values.AIWS_API_TOKEN;
    expect(token).toBeString();
    expect(values.AIWS_API_TOKEN_HASH).toBe(
      `sha256:${new Bun.CryptoHasher("sha256").update(token as string).digest("hex")}`,
    );
  });

  test("generates a runner token/hash and an independent control secret", async () => {
    const tokenOutput: string[] = [];
    expect(
      await runServerCommand(
        ["/app/aiws-server", "generate-runner-token"],
        {},
        commandIo(tokenOutput),
      ),
    ).toBe(0);
    const values = Object.fromEntries(
      tokenOutput
        .join("")
        .trim()
        .split("\n")
        .map((line) => line.split("=", 2)),
    );
    expect(values.AIWS_RUNNER_TOKEN_HASH).toBe(
      `sha256:${new Bun.CryptoHasher("sha256")
        .update(values.AIWS_RUNNER_TOKEN as string)
        .digest("hex")}`,
    );

    const controlOutput: string[] = [];
    expect(
      await runServerCommand(
        ["/app/aiws-server", "generate-runner-control-secret"],
        {},
        commandIo(controlOutput),
      ),
    ).toBe(0);
    const controlSecret = controlOutput.join("").trim().split("=", 2)[1];
    expect(controlSecret?.length).toBeGreaterThanOrEqual(32);
    expect(controlSecret).not.toBe(values.AIWS_RUNNER_TOKEN);
  });

  test("generates a 256-bit notification encryption key", async () => {
    const output: string[] = [];
    expect(
      await runServerCommand(
        ["/app/aiws-server", "generate-notification-encryption-key"],
        {},
        commandIo(output),
      ),
    ).toBe(0);
    const value = output.join("").trim().split("=", 2)[1];
    expect(Buffer.from(value as string, "base64").byteLength).toBe(32);
  });

  test("healthcheck succeeds only for a healthy database response", async () => {
    let healthy = true;
    const fetcher = (async () =>
      Response.json(
        { status: healthy ? "ok" : "unhealthy", version: "0.6.1" },
        { status: healthy ? 200 : 503 },
      )) as unknown as typeof fetch;
    const environment = { AIWS_ENV: "test" };
    expect(
      await runServerCommand(
        ["bun", "server.ts", "healthcheck"],
        environment,
        commandIo([]),
        fetcher,
      ),
    ).toBe(0);
    healthy = false;
    expect(
      await runServerCommand(
        ["bun", "server.ts", "healthcheck"],
        environment,
        commandIo([]),
        fetcher,
      ),
    ).toBe(1);
  });

  test("hash-password accepts stdin and emits a verifiable Argon2id hash", async () => {
    const output: string[] = [];
    const exitCode = await runServerCommand(
      ["bun", "server.ts", "hash-password"],
      {},
      {
        ...commandIo(output),
        stdin: Readable.from(["correct horse battery staple\n"]),
      },
    );
    const hash = output.join("").trim();

    expect(exitCode).toBe(0);
    expect(hash).toStartWith("$argon2id$");
    expect(await Bun.password.verify("correct horse battery staple", hash)).toBeTrue();
  });

  test("rejects an empty password and unknown operational commands", async () => {
    await expect(
      runServerCommand(
        ["bun", "server.ts", "hash-password"],
        {},
        {
          ...commandIo([]),
          stdin: Readable.from(["\n"]),
        },
      ),
    ).rejects.toThrow("must not be empty");
    expect(await runServerCommand(["bun", "server.ts", "unknown"], {}, commandIo([]))).toBe(2);
  });
});

describe("Hito 9 graceful shutdown", () => {
  test("waits for graceful stop before closing SQLite resources", async () => {
    const calls: string[] = [];
    const server: StoppableServer = {
      stop: async (force) => {
        calls.push(force ? "force" : "graceful");
      },
    };
    await shutdownServer(
      server,
      async () => {
        calls.push("close");
      },
      1_000,
    );
    expect(calls).toEqual(["graceful", "close"]);
  });

  test("forces active connections closed after the configured timeout", async () => {
    const calls: string[] = [];
    const server: StoppableServer = {
      stop: (force) => {
        calls.push(force ? "force" : "graceful");
        return force ? Promise.resolve() : new Promise(() => {});
      },
    };
    await shutdownServer(
      server,
      async () => {
        calls.push("close");
      },
      5,
    );
    expect(calls).toEqual(["graceful", "force", "close"]);
  });
});

function commandIo(output: string[]) {
  return {
    stdin: process.stdin,
    stdout: (value: string) => output.push(value),
    stderr: () => {},
  };
}
