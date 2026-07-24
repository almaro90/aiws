import { describe, expect, test } from "bun:test";
import { apiBaseUrl, createApiClient } from "../src/index.ts";

describe("API client", () => {
  test("normalizes the API base URL without duplicating the prefix", () => {
    expect(apiBaseUrl("http://localhost:3000")).toBe("http://localhost:3000/api/v1");
    expect(apiBaseUrl("http://localhost:3000/api/v1/")).toBe("http://localhost:3000/api/v1");
  });

  test("sends the bearer token and parses typed responses", async () => {
    let request: Request | undefined;
    const client = createApiClient({
      apiUrl: "http://localhost:3000",
      token: "test-token",
      fetch: async (input) => {
        request = new Request(input);
        return Response.json({ items: [], nextCursor: null });
      },
    });

    const result = await client.GET("/projects", { params: { query: {} } });
    expect(result.data).toEqual({ items: [], nextCursor: null });
    expect(request?.url).toBe("http://localhost:3000/api/v1/projects");
    expect(request?.headers.get("Authorization")).toBe("Bearer test-token");
  });
});
