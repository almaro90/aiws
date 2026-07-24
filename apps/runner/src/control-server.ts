import { timingSafeEqual } from "node:crypto";
import type { CatalogAuthMode, CodexModelCatalog } from "./model-catalog.ts";

export class RunnerControlServer {
  readonly server: ReturnType<typeof Bun.serve> | null;

  constructor(
    port: number,
    private readonly secret: string,
    private readonly catalog: CodexModelCatalog,
    start = true,
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
    this.server?.stop(true);
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== "/internal/model-catalog" || request.method !== "POST") {
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
    if (
      !isRecord(input) ||
      (input.authMode !== "api_key" && input.authMode !== "chatgpt_session") ||
      typeof input.credentialReference !== "string"
    ) {
      return new Response("Invalid request", { status: 422 });
    }
    try {
      return Response.json(
        await this.catalog.list(input.authMode as CatalogAuthMode, input.credentialReference),
      );
    } catch {
      return Response.json({ error: { code: "catalog_unavailable" } }, { status: 503 });
    }
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
