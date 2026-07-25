export interface Assignment {
  readonly run: {
    readonly id: string;
    readonly taskId: string;
    readonly branchName: string | null;
    readonly kind: "curation" | "implementation";
    readonly status: "queued" | "preparing";
    readonly executionStage: "agent" | "publishing";
    readonly resumeFromRunId: string | null;
    readonly baseSha: string | null;
    readonly headSha: string | null;
    readonly summary: string | null;
  };
  readonly task: {
    readonly id: string;
    readonly title: string;
    readonly userRequest: string;
    readonly curatorSpec: string;
    readonly version: number;
    readonly questions: readonly {
      readonly text: string;
      readonly type: string;
      readonly status: string;
      readonly answerText: string | null;
      readonly selectedOptionIds: readonly string[];
      readonly options: readonly { readonly id: string; readonly label: string }[];
    }[];
    readonly attachments: readonly {
      readonly id: string;
      readonly originalName: string;
      readonly mimeType: string;
    }[];
    readonly cycles: readonly { readonly id: string; readonly number: number }[];
    readonly messages: readonly {
      readonly cycleId: string;
      readonly type: string;
      readonly text: string | null;
      readonly createdAt: string;
    }[];
    readonly specRevisions: readonly {
      readonly cycleId: string;
      readonly revision: number;
      readonly content: string;
      readonly createdAt: string;
    }[];
  };
  readonly project: {
    readonly id: string;
    readonly repositoryPath: string;
    readonly remoteFullName: string | null;
    readonly defaultBranch: string | null;
  };
  readonly agentProfile: {
    readonly authMode: "api_key" | "chatgpt_session";
    readonly credentialReference: string;
    readonly model: string | null;
    readonly reasoningEffort: string | null;
  };
  readonly delivery: {
    readonly id: string;
    readonly branchName: string | null;
    readonly baseBranch: string | null;
    readonly prUrl: string | null;
  } | null;
}

interface GitCredentialBase {
  readonly cloneUrl: string;
  readonly fullName: string;
  readonly defaultBranch: string;
}
export type GitCredentials =
  | (GitCredentialBase & {
      readonly kind: "basic";
      readonly username: "x-access-token";
      readonly password: string;
    })
  | (GitCredentialBase & { readonly kind: "bearer"; readonly token: string });

export interface RunState {
  readonly id: string;
  readonly status: string;
  readonly executionStage: "agent" | "publishing";
  readonly resumeFromRunId: string | null;
}

export class AiwsRunnerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async claim(): Promise<Assignment | null> {
    const response = await this.call("/api/v1/runs/claim", { method: "POST" });
    return response.status === 204 ? null : (response.json() as Promise<Assignment>);
  }
  async reconcile(before: string): Promise<readonly RunState[]> {
    return this.json("/api/v1/runs/reconcile", { before });
  }
  async run(runId: string): Promise<RunState> {
    const response = await this.call(`/api/v1/runs/${runId}`, { method: "GET" });
    return response.json() as Promise<RunState>;
  }
  async advance(runId: string, body: Record<string, unknown>): Promise<void> {
    await this.json(`/api/v1/runs/${runId}/advance`, body);
  }
  async heartbeat(runId: string): Promise<void> {
    await this.json(`/api/v1/runs/${runId}/heartbeat`, {});
  }
  async uploadLogs(runId: string, jsonl: string): Promise<void> {
    await this.call(`/api/v1/runs/${runId}/logs`, {
      method: "PUT",
      headers: { "Content-Type": "application/x-ndjson" },
      body: jsonl,
    });
  }
  async credentials(runId: string): Promise<GitCredentials> {
    return this.json(`/api/v1/runs/${runId}/git-credentials`, {});
  }
  async pullRequest(
    runId: string,
    body: Record<string, unknown>,
  ): Promise<{ readonly prUrl: string }> {
    return this.json(`/api/v1/runs/${runId}/pull-request`, body);
  }
  async complete(runId: string, body: Record<string, unknown>): Promise<void> {
    await this.json(`/api/v1/runs/${runId}/complete`, body);
  }
  async completeCuration(runId: string, body: Record<string, unknown>): Promise<void> {
    await this.json(`/api/v1/runs/${runId}/curation-result`, body);
  }
  async fail(runId: string, body: Record<string, unknown>): Promise<void> {
    await this.json(`/api/v1/runs/${runId}/fail`, body);
  }
  async downloadAttachment(taskId: string, attachmentId: string): Promise<Uint8Array> {
    const response = await this.call(
      `/api/v1/tasks/${taskId}/attachments/${attachmentId}/content`,
      { method: "GET" },
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  private async json<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.call(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
  private async call(path: string, init: RequestInit): Promise<Response> {
    const response = await this.request(new URL(path, this.baseUrl), {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...init.headers },
    });
    if (!response.ok && response.status !== 204)
      throw new Error(`AIWS runner request ${path} failed with status ${response.status}.`);
    return response;
  }
}
