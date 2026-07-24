export interface LogEntry {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly time: string;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly error?: string;
}

export interface Logger {
  log(entry: LogEntry): void;
}

export class JsonLogger implements Logger {
  log(entry: LogEntry): void {
    console.log(JSON.stringify(entry));
  }
}
