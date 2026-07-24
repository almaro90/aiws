import { timingSafeEqual } from "node:crypto";

export class CredentialProxy {
  private readonly credentials = new Map<string, string>();
  readonly server: ReturnType<typeof Bun.serve> | null;

  constructor(
    port: number,
    private readonly upstream = "https://api.openai.com",
    start = true,
    private readonly upstreamRequest: typeof fetch = fetch,
  ) {
    this.server = start
      ? Bun.serve({
          port,
          hostname: "0.0.0.0",
          fetch: (request) => this.fetch(request),
        })
      : null;
  }
  grant(apiKey: string): string {
    const capability =
      crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    this.credentials.set(capability, apiKey);
    return capability;
  }
  revoke(capability: string): void {
    this.credentials.delete(capability);
  }
  stop(): void {
    this.server?.stop(true);
  }

  async fetch(request: Request): Promise<Response> {
    const authorization = request.headers.get("Authorization");
    const capability = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    const entry = [...this.credentials.entries()].find(([candidate]) =>
      safeEqual(candidate, capability),
    );
    if (entry === undefined) return new Response("Unauthorized", { status: 401 });
    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${entry[1]}`);
    headers.delete("host");
    headers.delete("content-length");
    return this.upstreamRequest(
      new URL(new URL(request.url).pathname + new URL(request.url).search, this.upstream),
      { method: request.method, headers, body: request.body, redirect: "manual" },
    );
  }
}
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
