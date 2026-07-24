import type { AgentAuthMode, AgentModelCatalog } from "@aiws/core";

export class RunnerModelCatalogClient {
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
}
