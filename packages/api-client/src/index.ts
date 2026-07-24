import createClient from "openapi-fetch";
import type { paths } from "./generated/schema.ts";

export type { components, operations, paths } from "./generated/schema.ts";

export interface ApiClientOptions {
  readonly apiUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return createClient<paths>({
    baseUrl: apiBaseUrl(options.apiUrl),
    headers: { Authorization: `Bearer ${options.token}` },
    fetch: async (input) => {
      const request = new Request(input);
      if (request.signal.aborted) return fetchImplementation(request);
      return fetchImplementation(new Request(request, { signal: AbortSignal.timeout(timeoutMs) }));
    },
  });
}

export function apiBaseUrl(value: string): string {
  const url = new URL(value);
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/api/v1`.replace(
    /\/api\/v1\/api\/v1$/u,
    "/api/v1",
  );
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}
