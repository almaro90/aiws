import type { Assignment } from "./client.ts";
import type { CredentialProxy } from "./credential-proxy.ts";

export interface AgentResult {
  readonly summary: string;
  readonly jsonl: string;
  readonly curationOutput?: Record<string, unknown>;
}

export class CodexExecutionError extends Error {
  constructor(
    message: string,
    readonly logs: string,
  ) {
    super(message);
    this.name = "CodexExecutionError";
  }
}

const MAX_LOG_BYTES = 5_000_000;
const LOG_HEAD_BYTES = 2_450_000;
const LOG_TAIL_BYTES = 2_450_000;
const TRUNCATION_MARKER = '\n{"type":"runner.logs_truncated"}\n';

export class RunLogBuffer {
  private head: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private tail: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private truncated = false;

  append(value: string): void {
    const bytes = new TextEncoder().encode(value);
    if (!this.truncated && this.head.byteLength + bytes.byteLength <= MAX_LOG_BYTES) {
      this.head = concatenate(this.head, bytes);
      return;
    }
    if (!this.truncated) {
      const combined = concatenate(this.head, bytes);
      this.head = combined.slice(0, LOG_HEAD_BYTES);
      this.tail = combined.slice(Math.max(LOG_HEAD_BYTES, combined.byteLength - LOG_TAIL_BYTES));
      this.truncated = true;
      return;
    }
    const combinedTail = concatenate(this.tail, bytes);
    this.tail = combinedTail.slice(Math.max(0, combinedTail.byteLength - LOG_TAIL_BYTES));
  }

  snapshot(): string {
    const decoder = new TextDecoder();
    const value = this.truncated
      ? `${decoder.decode(this.head)}${TRUNCATION_MARKER}${decoder.decode(this.tail)}`
      : decoder.decode(this.head);
    return redact(value);
  }
}

export class CodexRuntime {
  private readonly active = new Map<string, ReturnType<typeof Bun.spawn>>();
  constructor(
    private readonly image: string,
    private readonly network: string,
    private readonly proxy: CredentialProxy,
    private readonly proxyUrl: string,
    private readonly chatgptVolume: string,
    private readonly workspacesVolume: string,
  ) {}

  async execute(
    assignment: Assignment,
    workspace: string,
    onHeartbeat: () => Promise<void>,
    onLogs: (snapshot: string) => Promise<void>,
    getStatus: () => Promise<string>,
  ): Promise<AgentResult> {
    if (!workspace.endsWith(`/runs/${assignment.run.id}/repository`)) {
      throw new Error("Run workspace does not match its assignment.");
    }
    const args = [
      "docker",
      "run",
      "--rm",
      "--name",
      `aiws-${assignment.run.id}`,
      "--network",
      this.network,
      "--cpus",
      "2",
      "--memory",
      "4g",
      "--pids-limit",
      "512",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--mount",
      `type=volume,src=${this.workspacesVolume},dst=/workspace,volume-subpath=runs/${assignment.run.id}/repository${assignment.run.kind === "curation" ? ",readonly" : ""}`,
      "--mount",
      `type=volume,src=${this.workspacesVolume},dst=/attachments,volume-subpath=runs/${assignment.run.id}/attachments,readonly`,
      "--workdir",
      "/workspace",
    ];
    let capability: string | null = null;
    if (assignment.agentProfile.authMode === "api_key") {
      const secret = Bun.env[assignment.agentProfile.credentialReference];
      if (!secret)
        throw new Error(
          `Agent credential ${assignment.agentProfile.credentialReference} is not configured.`,
        );
      capability = this.proxy.grant(secret);
      args.push("-e", `CODEX_API_KEY=${capability}`);
    } else {
      args.push(
        "-e",
        "CODEX_HOME=/codex-home",
        "--mount",
        `type=volume,src=${this.chatgptVolume},dst=/codex-home`,
      );
    }
    args.push(
      this.image,
      "codex",
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--dangerously-bypass-approvals-and-sandbox",
    );
    if (capability !== null) args.push("-c", `openai_base_url="${this.proxyUrl}"`);
    args.push(...modelArguments(assignment.agentProfile));
    if (assignment.run.kind === "curation") {
      args.push("--output-schema", "/control/curation-output.schema.json");
      args.splice(
        args.indexOf("--workdir"),
        0,
        "--mount",
        `type=volume,src=${this.workspacesVolume},dst=/control,volume-subpath=runs/${assignment.run.id}/control,readonly`,
      );
      for (const attachment of assignment.task.attachments) {
        if (attachment.mimeType.startsWith("image/")) {
          args.push(
            "--image",
            `/attachments/${attachment.id}-${safeName(attachment.originalName)}`,
          );
        }
      }
    }
    args.push(buildPrompt(assignment));
    const heartbeat = setInterval(() => {
      void onHeartbeat().catch(() => undefined);
    }, 30_000);
    const logs = new RunLogBuffer();
    const snapshot = setInterval(() => void onLogs(logs.snapshot()).catch(() => undefined), 3_000);
    let stopping = false;
    const cancellation = setInterval(() => {
      void getStatus()
        .then((status) => {
          if (status === "cancelled" && !stopping) {
            stopping = true;
            void this.stop(assignment.run.id);
          }
        })
        .catch(() => undefined);
    }, 3_000);
    try {
      const process = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
        env: { PATH: Bun.env.PATH ?? "/usr/bin:/bin" },
      });
      this.active.set(assignment.run.id, process);
      const [stdout, stderr, code] = await Promise.all([
        consume(process.stdout, (chunk) => logs.append(chunk)),
        consume(process.stderr, (chunk) => logs.append(chunk)),
        process.exited,
      ]);
      await onLogs(logs.snapshot());
      if (code !== 0)
        throw new CodexExecutionError(
          `Codex exited ${code}: ${failureDiagnostics(stdout, stderr)}`,
          logs.snapshot(),
        );
      const message = finalMessage(stdout);
      if (assignment.run.kind === "curation") {
        let curationOutput: Record<string, unknown>;
        try {
          curationOutput = JSON.parse(message) as Record<string, unknown>;
        } catch {
          throw new Error("Codex returned invalid curation JSON.");
        }
        return {
          summary:
            typeof curationOutput.summary === "string"
              ? curationOutput.summary.slice(0, 10_000)
              : "Curation completed.",
          jsonl: logs.snapshot(),
          curationOutput,
        };
      }
      return { summary: message, jsonl: logs.snapshot() };
    } finally {
      clearInterval(heartbeat);
      clearInterval(snapshot);
      clearInterval(cancellation);
      this.active.delete(assignment.run.id);
      if (capability !== null) this.proxy.revoke(capability);
    }
  }

  async stop(runId: string): Promise<void> {
    const process = Bun.spawn(["docker", "stop", "--time", "3", `aiws-${runId}`], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await process.exited;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((runId) => this.stop(runId)));
  }
}

export function modelArguments(profile: Assignment["agentProfile"]): string[] {
  const args: string[] = [];
  if (profile.model !== null) args.push("--model", profile.model);
  if (profile.reasoningEffort !== null) {
    args.push("-c", `model_reasoning_effort="${profile.reasoningEffort}"`);
  }
  return args;
}

async function consume(
  stream: ReadableStream<Uint8Array>,
  append: (chunk: string) => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const captured = new RunLogBuffer();
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    const chunk = decoder.decode(result.value, { stream: true });
    captured.append(chunk);
    append(chunk);
  }
  const final = decoder.decode();
  captured.append(final);
  append(final);
  return captured.snapshot();
}

function concatenate(left: Uint8Array, right: Uint8Array): Uint8Array {
  const value = new Uint8Array(left.byteLength + right.byteLength);
  value.set(left);
  value.set(right, left.byteLength);
  return value;
}

function redact(value: string): string {
  return value.replaceAll(/(?:gh[psu]_|sk-)[A-Za-z0-9_-]+/gu, "[REDACTED]");
}

export const PROMPT_BUILDER_VERSION = "1";

export function buildPrompt(assignment: Assignment): string {
  if (assignment.run.kind === "curation") {
    const questions = curationQuestions(assignment.task.questions);
    const attachments = assignment.task.attachments
      .map(
        (attachment) =>
          `- /attachments/${attachment.id}-${safeName(attachment.originalName)} (${attachment.mimeType})`,
      )
      .join("\n");
    const history = assignment.task.messages
      .map(
        (message) =>
          `- ${message.createdAt} [${message.type}] ${message.text ?? "(attachments only)"}`,
      )
      .join("\n");
    const specs = assignment.task.specRevisions
      .map((spec) => `- cycle=${spec.cycleId} revision=${spec.revision}\n${spec.content}`)
      .join("\n\n");
    return `Curate this AIWS Task. You have read-only access to the repository and attachments. Inspect every applicable AGENTS.md and the relevant codebase before deciding. Do not modify files, commit, push, access AIWS, or use credentials.\n\nTitle: ${assignment.task.title}\n\nOriginal request projection:\n${assignment.task.userRequest}\n\nComplete message history:\n${history || "(none)"}\n\nSpec revision history:\n${specs || "(none)"}\n\nCurrent curator specification:\n${assignment.task.curatorSpec || "(none)"}\n\nQuestions and answers:\n${questions || "(none)"}\n\nAttachments:\n${attachments || "(none)"}\n\nFor PDF attachments, use the adjacent .txt extraction when present. Read textual attachments directly; images are also supplied through --image. Produce a sufficient spec for the checked-out delivery ref, including all incremental history that remains applicable. Ask questions only when a product ambiguity would materially change the result. Always return all schema fields. For ready, use a non-empty curatorSpec and an empty questions array. For blocked, use one to ten questions and curatorSpec may be null. Use null for an unchanged title. Return only the JSON required by the output schema.`;
  }
  return `Implement this AIWS Task in the current repository. Follow all repository AGENTS.md instructions.\n\nTitle: ${assignment.task.title}\n\nOriginal request (immutable):\n${assignment.task.userRequest}\n\nCurator specification:\n${assignment.task.curatorSpec}\n\nMake the smallest complete change and leave all intended modifications in the worktree. AIWS will execute the Project's captured Verification Contract after your work. You may run focused checks while developing, but do not commit, push, open a pull request, or access AIWS. In the final response summarize changes and checks.`;
}

export function curationQuestions(questions: Assignment["task"]["questions"]): string {
  return questions
    .map((question) => {
      const labelsById = new Map(question.options.map((option) => [option.id, option.label]));
      const selected = question.selectedOptionIds.map(
        (optionId) => labelsById.get(optionId) ?? `[unknown option: ${optionId}]`,
      );
      return `- ${question.text}\n  status=${question.status}; answer=${question.answerText ?? ""}; selected=${selected.join(" | ")}`;
    })
    .join("\n");
}
function safeName(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/gu, "_").slice(0, 180);
}
function finalMessage(jsonl: string): string {
  let final = "Automated implementation completed.";
  for (const line of jsonl.split("\n")) {
    try {
      const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
      if (
        event.type === "item.completed" &&
        event.item?.type === "agent_message" &&
        typeof event.item.text === "string"
      )
        final = event.item.text;
    } catch {
      /* Ignore non-JSON diagnostics. */
    }
  }
  return final.slice(0, 10_000);
}

export function failureDiagnostics(stdout: string, stderr: string): string {
  const messages = stderr.trim() === "" ? [] : [stderr.trim()];
  for (const line of stdout.split("\n")) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        message?: string;
        error?: { message?: string };
      };
      if (event.type === "error" && typeof event.message === "string") {
        messages.push(event.message);
      } else if (event.type === "turn.failed" && typeof event.error?.message === "string") {
        messages.push(event.error.message);
      }
    } catch {
      /* Ignore non-JSON diagnostics and successful agent output. */
    }
  }
  return redact([...new Set(messages)].join("\n")).slice(-4000);
}

export function runnerErrorLog(errorMessage: string): string {
  return `${JSON.stringify({ type: "runner.error", message: errorMessage })}\n`;
}

export function appendRunnerDiagnostic(logs: string, errorMessage: string): string {
  const buffer = new RunLogBuffer();
  buffer.append(logs);
  buffer.append(runnerErrorLog(errorMessage));
  return buffer.snapshot();
}
