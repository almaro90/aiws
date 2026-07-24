import { LocalCliError } from "./config.ts";

export interface CliIo {
  readonly stdout: (value: string) => void;
  readonly stdoutBytes: (value: Uint8Array) => void;
  readonly stderr: (value: string) => void;
  readonly readStdin: () => Promise<string>;
  readonly readSecret?: (prompt: string) => Promise<string>;
  readonly confirm: (question: string) => Promise<boolean>;
}

export const processIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stdoutBytes: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
  readStdin: async () => new Response(Bun.stdin.stream()).text(),
  readSecret: async (prompt) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
      return (await new Response(Bun.stdin.stream()).text()).replace(/[\r\n]+$/u, "");
    }
    process.stderr.write(prompt);
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let secret = "";
    try {
      return await new Promise<string>((resolve, reject) => {
        const onData = (chunk: string): void => {
          for (const character of chunk) {
            if (character === "\r" || character === "\n") {
              cleanup();
              process.stderr.write("\n");
              resolve(secret);
            } else if (character === "\u0003") {
              cleanup();
              process.stderr.write("\n");
              reject(new LocalCliError("input_cancelled", "Secret input cancelled.", 2));
            } else if (character === "\u007f" || character === "\b") {
              secret = secret.slice(0, -1);
            } else {
              secret += character;
            }
          }
        };
        const cleanup = (): void => {
          process.stdin.off("data", onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
        };
        process.stdin.on("data", onData);
      });
    } finally {
      process.stdin.setRawMode(false);
    }
  },
  confirm: async (question) => {
    process.stderr.write(`${question} [y/N] `);
    const answer = (await new Response(Bun.stdin.stream()).text()).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  },
};

export async function readTextInput(
  inline: string | undefined,
  filePath: string | undefined,
  label: string,
  io: CliIo,
): Promise<string> {
  if (inline !== undefined && filePath !== undefined) {
    throw new LocalCliError(
      "invalid_input",
      `--${label} and --${label}-file are mutually exclusive.`,
      2,
    );
  }
  if (inline === undefined && filePath === undefined) {
    throw new LocalCliError(
      "invalid_input",
      `One of --${label} or --${label}-file is required.`,
      2,
    );
  }
  try {
    const value =
      inline ??
      (filePath === "-" ? await io.readStdin() : await Bun.file(filePath as string).text());
    return value.replaceAll("\r\n", "\n");
  } catch {
    throw new LocalCliError("file_read_error", "Could not read input file.", 8, { path: filePath });
  }
}

export function writeResult(io: CliIo, value: unknown, json: boolean): void {
  if (json) {
    io.stdout(`${JSON.stringify(value)}\n`);
    return;
  }
  const listed = listItems(value);
  if (listed !== null) {
    io.stdout(renderTable(listed));
    if (isRecord(value) && typeof value.nextCursor === "string") {
      io.stderr(`Next cursor: ${value.nextCursor}\n`);
    }
    return;
  }
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeError(
  io: CliIo,
  error: { code: string; message: string; details?: unknown; requestId?: string | null },
  json: boolean,
): void {
  const body = {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      details: error.details ?? {},
      requestId: error.requestId ?? null,
    },
  };
  io.stderr(
    json
      ? `${JSON.stringify(body)}\n`
      : `Error: ${error.message}${error.requestId ? ` (${error.requestId})` : ""}\n`,
  );
}

function listItems(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.items)) return value.items;
  return null;
}

function renderTable(items: unknown[]): string {
  if (items.length === 0) return "No items.\n";
  const records = items.filter(isRecord);
  if (records.length !== items.length || records.length === 0) {
    return `${items.map((item) => String(item)).join("\n")}\n`;
  }
  const columns = [...new Set(records.flatMap((item) => Object.keys(item)))];
  const rows = [
    columns,
    ...records.map((item) => columns.map((column) => displayCell(item[column], column))),
  ];
  const widths = columns.map((_, index) => Math.max(...rows.map((row) => row[index]?.length ?? 0)));
  return `${rows
    .map((row) =>
      row
        .map((cell, index) => cell.padEnd(widths[index] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n")}\n`;
}

function displayCell(value: unknown, column: string): string {
  const encoded = typeof value === "string" ? value : JSON.stringify(value);
  const text = encoded ?? "";
  if (column === "id" || column.endsWith("Id") || text.length <= 40) return text;
  return `${text.slice(0, 39)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
