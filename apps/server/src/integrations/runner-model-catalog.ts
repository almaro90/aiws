import type { AgentAuthMode, AgentModelCatalog } from "@aiws/core";

export interface RunnerReadinessProfile {
  readonly kind: "curation" | "implementation";
  readonly authMode: AgentAuthMode;
  readonly credentialReference: string;
  readonly model: string | null;
  readonly reasoningEffort: string | null;
}

export interface RunnerReadinessCheck {
  readonly id: string;
  readonly status: "pass" | "fail" | "skipped";
  readonly message: string;
}

export class RunnerControlClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async list(authMode: AgentAuthMode, credentialReference: string): Promise<AgentModelCatalog> {
    const response = await this.request(new URL("/internal/model-catalog", this.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ authMode, credentialReference }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error("Runner model catalog is unavailable.");
    const catalog = (await response.json()) as AgentModelCatalog;
    if (!Array.isArray(catalog.models))
      throw new Error("Runner returned an invalid model catalog.");
    return catalog;
  }

  async readiness(
    profiles: readonly RunnerReadinessProfile[],
  ): Promise<readonly RunnerReadinessCheck[]> {
    const response = await this.request(new URL("/internal/project-readiness", this.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ profiles }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error("Runner readiness probe is unavailable.");
    const value: unknown = await response.json();
    if (!isRecord(value) || !Array.isArray(value.checks) || !value.checks.every(isCheck)) {
      throw new Error("Runner returned an invalid readiness report.");
    }
    return value.checks;
  }
}

function isCheck(value: unknown): value is RunnerReadinessCheck {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.status === "pass" || value.status === "fail" || value.status === "skipped") &&
    typeof value.message === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
