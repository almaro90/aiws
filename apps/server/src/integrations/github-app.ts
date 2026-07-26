import type { Connection } from "@aiws/core";
import { createSign, createHmac, timingSafeEqual } from "node:crypto";
import type {
  ManagedGitCredentials,
  ManagedGitProvider,
  PullRequestInput,
  RemoteBranch,
  RemoteRepository,
} from "./managed-git-provider.ts";
export type { RemoteBranch, RemoteRepository } from "./managed-git-provider.ts";

export interface GitHubAppConfig {
  readonly appId: string;
  readonly appSlug: string;
  readonly privateKey: string;
  readonly apiBaseUrl?: string;
  readonly webBaseUrl?: string;
  readonly fetch?: FetchImplementation;
}

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class GitHubAppGateway implements ManagedGitProvider {
  readonly provider = "github" as const;
  private readonly apiBaseUrl: string;
  private readonly webBaseUrl: string;
  private readonly request: FetchImplementation;

  constructor(private readonly config: GitHubAppConfig) {
    this.apiBaseUrl = config.apiBaseUrl ?? "https://api.github.com";
    this.webBaseUrl = config.webBaseUrl ?? "https://github.com";
    this.request = config.fetch ?? fetch;
  }

  installationUrl(state: string): string {
    const url = new URL(`/apps/${this.config.appSlug}/installations/new`, this.webBaseUrl);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async inspectInstallation(
    installationId: string,
  ): Promise<{ externalAccountId: string; displayName: string }> {
    const value = record(
      await this.appRequest(`/app/installations/${encodeURIComponent(installationId)}`),
      "GitHub installation",
    );
    const account = record(value.account, "GitHub installation account");
    return {
      externalAccountId: String(account.id),
      displayName: string(account.login, "GitHub account login"),
    };
  }

  async listRepositories(connection: Connection): Promise<readonly RemoteRepository[]> {
    const token = await this.installationToken(githubConnection(connection).installationId);
    const repositories: RemoteRepository[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const response = await this.installationRequest(
        token,
        `/installation/repositories?per_page=100&page=${page}`,
      );
      const rows = array(
        record(response, "GitHub repositories response").repositories,
        "GitHub repositories",
      );
      repositories.push(...rows.map(remoteRepository));
      if (rows.length < 100) break;
    }
    return repositories;
  }

  async getRepository(connection: Connection, repositoryId: string): Promise<RemoteRepository> {
    const token = await this.installationToken(githubConnection(connection).installationId);
    return remoteRepository(
      await this.installationRequest(token, `/repositories/${encodeURIComponent(repositoryId)}`),
    );
  }

  async listBranches(connection: Connection, repository: string): Promise<readonly RemoteBranch[]> {
    const token = await this.installationToken(githubConnection(connection).installationId);
    const branches: RemoteBranch[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const rows = array(
        await this.installationRequest(
          token,
          `/repos/${repository}/branches?per_page=100&page=${page}`,
        ),
        "GitHub branches",
      );
      branches.push(...rows.map(remoteBranch));
      if (rows.length < 100) break;
    }
    return branches;
  }

  async accessToken(connection: Connection): Promise<string> {
    return this.installationToken(githubConnection(connection).installationId);
  }

  async gitCredentials(
    connection: Connection,
    repositoryId: string,
  ): Promise<ManagedGitCredentials> {
    const repository = await this.getRepository(connection, repositoryId);
    return {
      kind: "basic",
      cloneUrl: repository.cloneUrl,
      username: "x-access-token",
      password: await this.accessToken(connection),
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
    };
  }

  async createPullRequest(
    connection: Connection,
    repository: string,
    input: {
      readonly title: string;
      readonly body: string;
      readonly head: string;
      readonly base: string;
      readonly draft: boolean;
    },
  ): Promise<string> {
    const token = await this.installationToken(githubConnection(connection).installationId);
    const response = record(
      await this.installationRequest(token, `/repos/${repository}/pulls`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
      "GitHub pull request",
    );
    return string(response.html_url, "GitHub pull request URL");
  }

  async publishPullRequest(
    connection: Connection,
    repository: string,
    repositoryIdOrInput: string | PullRequestInput,
    inputOrExistingUrl: PullRequestInput | string | null,
    maybeExistingUrl?: string | null,
  ): Promise<string> {
    const input =
      typeof repositoryIdOrInput === "string"
        ? (inputOrExistingUrl as PullRequestInput)
        : repositoryIdOrInput;
    const existingUrl =
      typeof repositoryIdOrInput === "string"
        ? (maybeExistingUrl ?? null)
        : (inputOrExistingUrl as string | null);
    let pullNumber = existingUrl?.match(/\/pull\/(\d+)\/?$/u)?.[1];
    if (pullNumber === undefined) {
      const owner = repository.split("/")[0];
      if (owner !== undefined) {
        const token = await this.installationToken(githubConnection(connection).installationId);
        const response = await this.installationRequest(
          token,
          `/repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${input.head}`)}`,
        );
        if (Array.isArray(response)) {
          const existing = response[0];
          if (typeof existing === "object" && existing !== null && "number" in existing) {
            pullNumber = String(existing.number);
          }
        }
      }
    }
    if (pullNumber !== undefined) {
      const token = await this.installationToken(githubConnection(connection).installationId);
      const existing = record(
        await this.installationRequest(token, `/repos/${repository}/pulls/${pullNumber}`),
        "GitHub pull request",
      );
      if (existing.state === "open") {
        const response = record(
          await this.installationRequest(token, `/repos/${repository}/pulls/${pullNumber}`, {
            method: "PATCH",
            body: JSON.stringify({ title: input.title, body: input.body }),
          }),
          "GitHub pull request",
        );
        return string(response.html_url, "GitHub pull request URL");
      }
    }
    return this.createPullRequest(connection, repository, input);
  }

  async observeDelivery(
    connection: Connection,
    repository: string,
    _repositoryId: string,
    prUrl: string,
    headSha: string | null,
  ): Promise<import("./managed-git-provider.ts").ExternalDeliveryObservation> {
    const pullNumber = prUrl.match(/\/pull\/(\d+)\/?$/u)?.[1];
    if (pullNumber === undefined) throw new Error("GitHub pull request URL is invalid.");
    const token = await this.installationToken(githubConnection(connection).installationId);
    const pull = record(
      await this.installationRequest(token, `/repos/${repository}/pulls/${pullNumber}`),
      "GitHub pull request",
    );
    const sha =
      headSha ??
      (typeof pull.head === "object" && pull.head !== null && "sha" in pull.head
        ? string(pull.head.sha, "GitHub head SHA")
        : null);
    const checks =
      sha === null
        ? []
        : array(
            record(
              await this.installationRequest(
                token,
                `/repos/${repository}/commits/${encodeURIComponent(sha)}/check-runs`,
              ),
              "GitHub checks",
            ).check_runs,
            "GitHub checks",
          ).map((item) => record(item, "GitHub check"));
    const counts = checkCounts(
      checks.map((check) => ({
        pending: check.status !== "completed",
        passed: check.conclusion === "success" || check.conclusion === "neutral",
      })),
    );
    return {
      prState:
        pull.merged_at !== null && pull.merged_at !== undefined
          ? "merged"
          : pull.state === "closed"
            ? "closed"
            : pull.draft === true
              ? "draft"
              : "open",
      ...counts,
      externalUpdatedAt: typeof pull.updated_at === "string" ? pull.updated_at : null,
    };
  }

  private async installationToken(installationId: string): Promise<string> {
    const response = record(
      await this.appRequest(
        `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
        { method: "POST" },
      ),
      "GitHub installation token",
    );
    return string(response.token, "GitHub installation token");
  }

  private appRequest(path: string, init: RequestInit = {}): Promise<unknown> {
    return this.githubRequest(path, this.appJwt(), init);
  }
  private installationRequest(
    token: string,
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    return this.githubRequest(path, token, init);
  }
  private async githubRequest(path: string, token: string, init: RequestInit): Promise<unknown> {
    const response = await this.request(new URL(path, this.apiBaseUrl), {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`GitHub request failed with status ${response.status}.`);
    return response.json();
  }
  private appJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64Url(
      JSON.stringify({ iat: now - 60, exp: now + 540, iss: this.config.appId }),
    );
    const unsigned = `${header}.${payload}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    return `${unsigned}.${signer.sign(this.config.privateKey).toString("base64url")}`;
  }
}

function checkCounts(checks: readonly { readonly pending: boolean; readonly passed: boolean }[]) {
  const checksPending = checks.filter((check) => check.pending).length;
  const checksPassed = checks.filter((check) => !check.pending && check.passed).length;
  const checksFailed = checks.length - checksPending - checksPassed;
  return {
    checksPassed,
    checksFailed,
    checksPending,
    checksState:
      checks.length === 0
        ? ("unknown" as const)
        : checksFailed > 0
          ? ("failed" as const)
          : checksPending > 0
            ? ("pending" as const)
            : ("passed" as const),
  };
}

function githubConnection(connection: Connection): Extract<Connection, { provider: "github" }> {
  if (connection.provider !== "github") {
    throw new Error("GitHub provider received a non-GitHub Connection.");
  }
  return connection;
}

export function createOauthState(secret: string, returnTo: string, now = Date.now()): string {
  const safeReturnTo =
    returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/projects";
  const payload = base64Url(
    JSON.stringify({
      returnTo: safeReturnTo,
      expiresAt: now + 10 * 60_000,
      nonce: crypto.randomUUID(),
    }),
  );
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function verifyOauthState(
  state: string,
  secret: string,
  now = Date.now(),
): { readonly returnTo: string } | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const value = record(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      "OAuth state",
    );
    if (typeof value.expiresAt !== "number" || value.expiresAt < now) return null;
    return { returnTo: string(value.returnTo, "OAuth return URL") };
  } catch {
    return null;
  }
}

function remoteRepository(value: unknown): RemoteRepository {
  const row = record(value, "GitHub repository");
  return {
    id: String(row.id),
    fullName: string(row.full_name, "repository full name"),
    name: string(row.name, "repository name"),
    description: typeof row.description === "string" ? row.description : "",
    webUrl: string(row.html_url, "repository URL"),
    cloneUrl: string(row.clone_url, "repository clone URL"),
    defaultBranch: string(row.default_branch, "default branch"),
    private: row.private === true,
  };
}
function remoteBranch(value: unknown): RemoteBranch {
  const row = record(value, "GitHub branch");
  const commit = record(row.commit, "GitHub branch commit");
  return {
    name: string(row.name, "branch name"),
    sha: string(commit.sha, "branch commit SHA"),
    protected: row.protected === true,
  };
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} is invalid.`);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is invalid.`);
  return value;
}
function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}
