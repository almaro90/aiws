import { timingSafeEqual } from "node:crypto";
import type { CatalogAuthMode, CodexModelCatalog } from "./model-catalog.ts";
import type { ReadinessProfile, RunnerReadinessProbe } from "./readiness.ts";

export class RunnerControlServer {
  readonly server: ReturnType<typeof Bun.serve> | null;

  constructor(
    port: number,
    private readonly secret: string,
    private readonly catalog: CodexModelCatalog,
    start = true,
    private readonly readiness?: RunnerReadinessProbe,
  ) {
    this.server = start
      ? Bun.serve({
          port,
          hostname: "0.0.0.0",
          fetch: (request) => this.fetch(request),
        })
      : null;
  }

  stop(): void {
    this.server?.stop(false);
  }

  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (
      (pathname !== "/internal/model-catalog" && pathname !== "/internal/project-readiness") ||
      request.method !== "POST"
    ) {
      return new Response("Not found", { status: 404 });
    }
    const authorization = request.headers.get("Authorization");
    const received = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!safeEqual(this.secret, received)) return new Response("Forbidden", { status: 403 });
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return new Response("Invalid request", { status: 422 });
    }
    try {
      if (pathname === "/internal/project-readiness") {
        if (
          this.readiness === undefined ||
          !isRecord(input) ||
          !Array.isArray(input.profiles) ||
          !input.profiles.every(isReadinessProfile)
        ) {
          return new Response("Invalid request", { status: 422 });
        }
        return Response.json({
          checks: await this.readiness.check(input.profiles, request.signal),
        });
      }
      if (
        !isRecord(input) ||
        (input.authMode !== "api_key" && input.authMode !== "chatgpt_session") ||
        typeof input.credentialReference !== "string"
      ) {
        return new Response("Invalid request", { status: 422 });
      }
      return Response.json(
        await this.catalog.list(input.authMode as CatalogAuthMode, input.credentialReference),
      );
    } catch {
      return Response.json({ error: { code: "catalog_unavailable" } }, { status: 503 });
    }
  }
}

function isReadinessProfile(value: unknown): value is ReadinessProfile {
  return (
    isRecord(value) &&
    (value.kind === "curation" || value.kind === "implementation") &&
    (value.authMode === "api_key" || value.authMode === "chatgpt_session") &&
    typeof value.credentialReference === "string" &&
    (typeof value.model === "string" || value.model === null) &&
    (typeof value.reasoningEffort === "string" || value.reasoningEffort === null)
  );
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
