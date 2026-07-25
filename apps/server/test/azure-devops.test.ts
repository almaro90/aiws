import { afterEach, describe, expect, test } from "bun:test";
import { openDatabase } from "@aiws/sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AzureAccessTokenManager,
  AzureDevOpsAuthorizationService,
  AzureDevOpsProvider,
  truncatePullRequestDescription,
} from "../src/integrations/azure-devops.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Azure DevOps managed provider", () => {
  test("uses one-time PKCE state and stores the selected organization credential encrypted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aiws-azure-"));
    directories.push(directory);
    const database = openDatabase({ path: join(directory, "aiws.sqlite") });
    const requests: URL[] = [];
    let currentTime = new Date("2026-07-25T10:00:00.000Z");
    const request = async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input);
      requests.push(url);
      if (url.pathname.endsWith("/token")) {
        return Response.json({
          access_token: "short-lived-access-token",
          refresh_token: "long-lived-refresh-token",
          expires_in: 3600,
        });
      }
      if (url.pathname.endsWith("/profiles/me")) {
        return Response.json({ id: "member-1", displayName: "Ada Lovelace" });
      }
      if (url.pathname.endsWith("/accounts")) {
        return Response.json({
          value: [
            { accountId: "org-1", accountName: "acme" },
            { accountId: "org-2", accountName: "labs" },
          ],
        });
      }
      return new Response(null, { status: 404 });
    };
    const service = new AzureDevOpsAuthorizationService(
      database,
      {
        clientId: "client",
        clientSecret: "secret",
        redirectUri: "https://aiws.example/api/v1/connections/azure-devops/callback",
        encryptionKey: new Uint8Array(32).fill(7),
        fetch: request,
        authorizeUrl: "https://login.test/organizations/oauth2/v2.0/authorize",
        tokenUrl: "https://login.test/organizations/oauth2/v2.0/token",
        profileBaseUrl: "https://profile.test",
      },
      () => currentTime,
    );

    const expired = new URL(service.begin().url);
    currentTime = new Date("2026-07-25T10:11:00.000Z");
    await expect(
      service.callback(expired.searchParams.get("state") as string, "expired-code"),
    ).rejects.toThrow("invalid or expired");
    currentTime = new Date("2026-07-25T10:12:00.000Z");

    const authorization = new URL(service.begin().url);
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("scope")).toContain(".default");
    expect(authorization.searchParams.get("scope")).toContain("offline_access");
    const state = authorization.searchParams.get("state") as string;
    const authorizationId = await service.callback(state, "code");
    expect(service.organizations(authorizationId)).toEqual([
      { id: "org-1", name: "acme" },
      { id: "org-2", name: "labs" },
    ]);
    await expect(service.callback(state, "code")).rejects.toThrow("invalid or expired");
    expect(() => service.complete(authorizationId, "unknown")).toThrow("not in");

    const connection = service.complete(authorizationId, "org-2");
    expect(connection).toMatchObject({
      provider: "azure_devops",
      organizationId: "org-2",
      organizationName: "labs",
      status: "active",
    });
    const stored = database
      .query<{ plaintext: number; ciphertext: number }, [string]>(
        `SELECT instr(CAST(refresh_token_ciphertext AS TEXT), 'long-lived-refresh-token') AS plaintext,
                length(refresh_token_ciphertext) AS ciphertext
         FROM connections WHERE id = ?`,
      )
      .get(connection.id);
    expect(stored?.plaintext).toBe(0);
    expect(stored?.ciphertext).toBeGreaterThan(0);
    expect(requests.some((url) => url.pathname.endsWith("/accounts"))).toBe(true);

    const reauthorization = new URL(service.begin(connection.id).url);
    const reauthorizationId = await service.callback(
      reauthorization.searchParams.get("state") as string,
      "code",
    );
    const reauthorized = service.complete(reauthorizationId, "org-2");
    expect(reauthorized.id).toBe(connection.id);
    expect(reauthorized.createdAt).toBe(connection.createdAt);

    const invalidGrantTokens = new AzureAccessTokenManager(database, {
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "https://aiws.example/callback",
      encryptionKey: new Uint8Array(32).fill(7),
      tokenUrl: "https://login.test/token",
      fetch: async () => Response.json({ error: "invalid_grant" }, { status: 400 }),
    });
    await expect(invalidGrantTokens.token(reauthorized)).rejects.toThrow("invalid_grant");
    expect(
      database
        .query<{ status: string }, [string]>("SELECT status FROM connections WHERE id = ?")
        .get(connection.id)?.status,
    ).toBe("reauthorization_required");
    database.close();
  });

  test("maps repositories, refs and draft pull requests through Azure REST 7.1", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aiws-azure-provider-"));
    directories.push(directory);
    const database = openDatabase({ path: join(directory, "aiws.sqlite") });
    const key = new Uint8Array(32).fill(9);
    const bootstrap = new AzureDevOpsAuthorizationService(database, {
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "https://aiws.example/callback",
      encryptionKey: key,
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname.endsWith("/token")) {
          return Response.json({ access_token: "a1", refresh_token: "r1", expires_in: 1 });
        }
        if (url.pathname.endsWith("/profiles/me")) {
          return Response.json({ id: "member", displayName: "Ada" });
        }
        return Response.json({ value: [{ accountId: "org", accountName: "acme" }] });
      },
      authorizeUrl: "https://login.test/authorize",
      tokenUrl: "https://login.test/token",
      profileBaseUrl: "https://profile.test",
    });
    const begin = new URL(bootstrap.begin().url);
    const authorizationId = await bootstrap.callback(
      begin.searchParams.get("state") as string,
      "code",
    );
    const connection = bootstrap.complete(authorizationId, "org");
    const seen: { url: URL; init?: RequestInit }[] = [];
    const request = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input);
      seen.push(init === undefined ? { url } : { url, init });
      if (url.pathname.endsWith("/token")) {
        return Response.json({
          access_token: "fresh-access",
          refresh_token: "rotated-refresh",
          expires_in: 3600,
        });
      }
      if (url.pathname.endsWith("/refs")) {
        return Response.json({
          value: [{ name: "refs/heads/main", objectId: "abc123" }],
        });
      }
      if (url.pathname.endsWith("/pullrequests") && init?.method === "POST") {
        return Response.json({
          pullRequestId: 12,
          _links: { web: { href: "https://dev.azure.com/acme/App/_git/Repo/pullrequest/12" } },
        });
      }
      if (url.pathname.endsWith("/pullrequests/12") && init?.method === "PATCH") {
        return Response.json({
          pullRequestId: 12,
          status: "active",
          _links: { web: { href: "https://dev.azure.com/acme/App/_git/Repo/pullrequest/12" } },
        });
      }
      if (url.pathname.endsWith("/pullrequests/12")) {
        return Response.json({
          pullRequestId: 12,
          status: "active",
          _links: { web: { href: "https://dev.azure.com/acme/App/_git/Repo/pullrequest/12" } },
        });
      }
      if (url.pathname.endsWith("/pullrequests")) return Response.json({ value: [] });
      const repository = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Repo",
        project: { name: "App" },
        webUrl: "https://dev.azure.com/acme/App/_git/Repo",
        remoteUrl: "https://dev.azure.com/acme/App/_git/Repo",
        defaultBranch: "refs/heads/main",
      };
      if (url.pathname.includes("/repositories/")) return Response.json(repository);
      return Response.json({ value: [repository] });
    };
    const config = {
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "https://aiws.example/callback",
      encryptionKey: key,
      fetch: request,
      tokenUrl: "https://login.test/token",
      apiBaseUrl: "https://dev.azure.test",
    };
    const provider = new AzureDevOpsProvider(new AzureAccessTokenManager(database, config), config);
    expect(await provider.listRepositories(connection)).toEqual([
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        fullName: "App/Repo",
        name: "Repo",
        description: "",
        webUrl: "https://dev.azure.com/acme/App/_git/Repo",
        cloneUrl: "https://dev.azure.com/acme/App/_git/Repo",
        defaultBranch: "main",
        private: true,
      },
    ]);
    const rotatedCredential = database
      .query<{ plaintext: number }, [string]>(
        `SELECT instr(CAST(refresh_token_ciphertext AS TEXT), 'rotated-refresh') AS plaintext
         FROM connections WHERE id = ?`,
      )
      .get(connection.id);
    expect(rotatedCredential?.plaintext).toBe(0);
    expect(
      await provider.listBranches(connection, "App/Repo", "550e8400-e29b-41d4-a716-446655440000"),
    ).toEqual([{ name: "main", sha: "abc123", protected: null }]);
    const prUrl = await provider.publishPullRequest(
      connection,
      "App/Repo",
      "550e8400-e29b-41d4-a716-446655440000",
      {
        title: "Change",
        body: `${"x".repeat(5_000)}\n\nAIWS Task: tsk_01K00000000000000000000000`,
        head: "aiws/task",
        base: "main",
        draft: true,
      },
      null,
    );
    expect(prUrl).toEndWith("/pullrequest/12");
    const create = seen.find(
      (entry) => entry.init?.method === "POST" && entry.url.pathname.endsWith("/pullrequests"),
    );
    const payload = JSON.parse(String(create?.init?.body));
    expect(payload.isDraft).toBe(true);
    expect(payload.sourceRefName).toBe("refs/heads/aiws/task");
    expect(payload.targetRefName).toBe("refs/heads/main");
    expect(payload.description.length).toBeLessThanOrEqual(4_000);
    expect(payload.description).toEndWith("AIWS Task: tsk_01K00000000000000000000000");
    expect(
      await provider.publishPullRequest(
        connection,
        "App/Repo",
        "550e8400-e29b-41d4-a716-446655440000",
        {
          title: "Updated",
          body: "Updated body\n\nAIWS Task: tsk_01K00000000000000000000000",
          head: "aiws/task",
          base: "main",
          draft: true,
        },
        prUrl,
      ),
    ).toBe(prUrl);
    const update = seen.find(
      (entry) => entry.url.pathname.endsWith("/pullrequests/12") && entry.init?.method === "PATCH",
    );
    expect(JSON.parse(String(update?.init?.body))).toMatchObject({
      title: "Updated",
      isDraft: true,
    });
    database.close();
  });

  test("truncates PR descriptions deterministically while preserving the Task footer", () => {
    const body = `${"summary ".repeat(1_000)}\n\nAIWS Task: tsk_123`;
    const first = truncatePullRequestDescription(body);
    expect(first).toBe(truncatePullRequestDescription(body));
    expect(first.length).toBeLessThanOrEqual(4_000);
    expect(first).toEndWith("AIWS Task: tsk_123");
  });
});
