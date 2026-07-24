import { describe, expect, test } from "bun:test";
import { CredentialProxy } from "../src/credential-proxy.ts";

describe("CredentialProxy", () => {
  test("exchanges a revocable capability without exposing the permanent key", async () => {
    const upstreamAuthorizations: (string | null)[] = [];
    const proxy = new CredentialProxy(4317, "https://api.openai.test", false, (async (
      input,
      init,
    ) => {
      const request = new Request(input, init);
      upstreamAuthorizations.push(request.headers.get("Authorization"));
      return Response.json({ ok: true });
    }) as typeof fetch);
    const capability = proxy.grant("sk-permanent-secret");
    expect(capability).not.toContain("permanent");
    const response = await proxy.fetch(
      new Request("http://runner-manager:4317/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${capability}`, "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);
    expect(upstreamAuthorizations).toEqual(["Bearer sk-permanent-secret"]);
    proxy.revoke(capability);
    expect(
      (
        await proxy.fetch(
          new Request("http://runner-manager:4317/v1/responses", {
            headers: { Authorization: `Bearer ${capability}` },
          }),
        )
      ).status,
    ).toBe(401);
  });
});
