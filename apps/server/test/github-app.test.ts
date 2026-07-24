import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import type { Connection } from "@aiws/core";
import {
  createOauthState,
  GitHubAppGateway,
  verifyOauthState,
} from "../src/integrations/github-app.ts";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const connection = {
  id: "con_01K0ABCDEFGHIJKLMNOPQRSTUV",
  provider: "github",
  host: "https://github.com",
  externalAccountId: "42",
  displayName: "acme",
  installationId: "100",
  status: "active",
  createdAt: "2026-07-21T10:00:00.000Z",
  updatedAt: "2026-07-21T10:00:00.000Z",
} as Connection;

describe("GitHub App gateway", () => {
  test("signs expiring callback state without exposing the session secret", () => {
    const state = createOauthState("secret", "/projects", 1000);
    expect(state).not.toContain("secret");
    expect(verifyOauthState(state, "secret", 1001)).toEqual({ returnTo: "/projects" });
    expect(verifyOauthState(state, "wrong", 1001)).toBeNull();
    expect(verifyOauthState(state, "secret", 1000 + 10 * 60_000 + 1)).toBeNull();
    expect(
      verifyOauthState(createOauthState("secret", "https://evil.example", 1000), "secret", 1001),
    ).toEqual({ returnTo: "/projects" });
  });

  test("uses short-lived installation authentication to list repos and create a PR", async () => {
    const requests: { readonly path: string; readonly authorization: string | null }[] = [];
    const gateway = new GitHubAppGateway({
      appId: "1",
      appSlug: "aiws-test",
      privateKey,
      apiBaseUrl: "https://api.github.test",
      fetch: async (input, init) => {
        const url = new URL(String(input));
        requests.push({
          path: url.pathname,
          authorization: new Headers(init?.headers).get("Authorization"),
        });
        if (url.pathname.endsWith("/access_tokens"))
          return Response.json({ token: "ghs_short_lived" });
        if (url.pathname === "/installation/repositories")
          return Response.json({
            repositories: [
              {
                id: 7,
                full_name: "acme/repo",
                name: "repo",
                description: null,
                html_url: "https://github.com/acme/repo",
                clone_url: "https://github.com/acme/repo.git",
                default_branch: "main",
                private: true,
              },
            ],
          });
        if (url.pathname === "/repos/acme/repo/branches")
          return Response.json([
            { name: "main", commit: { sha: "a".repeat(40) }, protected: true },
            { name: "release/next", commit: { sha: "b".repeat(40) }, protected: false },
          ]);
        if (url.pathname === "/repos/acme/repo/pulls")
          return Response.json({ html_url: "https://github.com/acme/repo/pull/1" });
        return new Response("not found", { status: 404 });
      },
    });
    const repositories = await gateway.listRepositories(connection);
    expect(repositories).toEqual([
      {
        id: "7",
        fullName: "acme/repo",
        name: "repo",
        description: "",
        webUrl: "https://github.com/acme/repo",
        cloneUrl: "https://github.com/acme/repo.git",
        defaultBranch: "main",
        private: true,
      },
    ]);
    expect(await gateway.listBranches(connection, "acme/repo")).toEqual([
      { name: "main", sha: "a".repeat(40), protected: true },
      { name: "release/next", sha: "b".repeat(40), protected: false },
    ]);
    expect(
      await gateway.createPullRequest(connection, "acme/repo", {
        title: "Task",
        body: "Body",
        head: "aiws/run",
        base: "main",
        draft: true,
      }),
    ).toBe("https://github.com/acme/repo/pull/1");
    expect(requests.some((request) => request.authorization === "Bearer ghs_short_lived")).toBe(
      true,
    );
    expect(requests.every((request) => !request.path.includes("ghs_short_lived"))).toBe(true);
  });

  test("updates only an open PR and creates a new PR after the previous one closes", async () => {
    const methods: string[] = [];
    const gateway = new GitHubAppGateway({
      appId: "1",
      appSlug: "aiws-test",
      privateKey,
      apiBaseUrl: "https://api.github.test",
      fetch: async (input, init) => {
        const url = new URL(String(input));
        methods.push(`${init?.method ?? "GET"} ${url.pathname}`);
        if (url.pathname.endsWith("/access_tokens"))
          return Response.json({ token: "ghs_short_lived" });
        if (url.pathname.endsWith("/pulls/1") && init?.method !== "PATCH")
          return Response.json({
            state: "open",
            draft: true,
            html_url: "https://github.com/acme/repo/pull/1",
          });
        if (url.pathname.endsWith("/pulls/1"))
          return Response.json({ html_url: "https://github.com/acme/repo/pull/1" });
        if (url.pathname.endsWith("/pulls/2"))
          return Response.json({
            state: "closed",
            merged: true,
            html_url: "https://github.com/acme/repo/pull/2",
          });
        if (url.pathname.endsWith("/pulls"))
          return Response.json({ html_url: "https://github.com/acme/repo/pull/3" });
        return new Response("not found", { status: 404 });
      },
    });
    const input = {
      title: "Task",
      body: "Updated",
      head: "aiws/delivery",
      base: "main",
      draft: true,
    };

    expect(
      await gateway.publishPullRequest(
        connection,
        "acme/repo",
        input,
        "https://github.com/acme/repo/pull/1",
      ),
    ).toEndWith("/pull/1");
    expect(
      await gateway.publishPullRequest(
        connection,
        "acme/repo",
        input,
        "https://github.com/acme/repo/pull/2",
      ),
    ).toEndWith("/pull/3");
    expect(methods).toContain("PATCH /repos/acme/repo/pulls/1");
    expect(methods).not.toContain("PATCH /repos/acme/repo/pulls/2");
    expect(methods).toContain("POST /repos/acme/repo/pulls");
  });

  test("reuses an open PR discovered by head after an interrupted publishing attempt", async () => {
    const methods: string[] = [];
    const gateway = new GitHubAppGateway({
      appId: "1",
      appSlug: "aiws-test",
      privateKey,
      apiBaseUrl: "https://api.github.test",
      fetch: async (input, init) => {
        const url = new URL(String(input));
        methods.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
        if (url.pathname.endsWith("/access_tokens"))
          return Response.json({ token: "ghs_short_lived" });
        if (
          url.pathname.endsWith("/pulls") &&
          url.searchParams.get("head") === "acme:aiws/delivery"
        )
          return Response.json([{ number: 7 }]);
        if (url.pathname.endsWith("/pulls/7") && init?.method !== "PATCH")
          return Response.json({ state: "open", html_url: "https://github.com/acme/repo/pull/7" });
        if (url.pathname.endsWith("/pulls/7"))
          return Response.json({ html_url: "https://github.com/acme/repo/pull/7" });
        if (url.pathname.endsWith("/pulls"))
          return Response.json({ html_url: "https://github.com/acme/repo/pull/8" });
        return new Response("not found", { status: 404 });
      },
    });

    const result = await gateway.publishPullRequest(
      connection,
      "acme/repo",
      { title: "Task", body: "Body", head: "aiws/delivery", base: "main", draft: true },
      null,
    );
    expect(result).toEndWith("/pull/7");
    expect(methods).toContain("PATCH /repos/acme/repo/pulls/7");
    expect(methods.filter((method) => method === "POST /repos/acme/repo/pulls")).toHaveLength(0);
  });
});
