import type { Connection, ConnectionId } from "@aiws/core";
import type { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type {
  ManagedGitCredentials,
  ManagedGitProvider,
  PullRequestInput,
  RemoteBranch,
  RemoteRepository,
} from "./managed-git-provider.ts";

const AZURE_DEVOPS_SCOPE = "499b84ac-1321-427f-aa17-267ca6975798/.default offline_access";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface AzureDevOpsConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly encryptionKey: Uint8Array;
  readonly fetch?: FetchImplementation;
  readonly authorizeUrl?: string;
  readonly tokenUrl?: string;
  readonly profileBaseUrl?: string;
  readonly apiBaseUrl?: string;
}

interface EncryptedValue {
  readonly ciphertext: Uint8Array;
  readonly iv: Uint8Array;
  readonly authTag: Uint8Array;
}

interface AuthorizationSnapshot {
  readonly externalAccountId: string;
  readonly displayName: string;
  readonly refreshToken: string;
  readonly organizations: readonly AzureOrganization[];
}

export interface AzureOrganization {
  readonly id: string;
  readonly name: string;
}

interface AuthorizationRow {
  readonly id: string;
  readonly code_verifier_ciphertext: Uint8Array | null;
  readonly code_verifier_iv: Uint8Array | null;
  readonly code_verifier_auth_tag: Uint8Array | null;
  readonly snapshot_ciphertext: Uint8Array | null;
  readonly snapshot_iv: Uint8Array | null;
  readonly snapshot_auth_tag: Uint8Array | null;
  readonly reauthorize_connection_id: string | null;
  readonly callback_consumed_at: string | null;
  readonly completed_at: string | null;
  readonly expires_at: string;
}

export class AzureDevOpsAuthorizationService {
  private readonly request: FetchImplementation;
  private readonly authorizeUrl: string;
  private readonly tokenUrl: string;
  private readonly profileBaseUrl: string;

  constructor(
    private readonly database: Database,
    private readonly config: AzureDevOpsConfig,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.request = config.fetch ?? fetch;
    this.authorizeUrl =
      config.authorizeUrl ??
      "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize";
    this.tokenUrl =
      config.tokenUrl ?? "https://login.microsoftonline.com/organizations/oauth2/v2.0/token";
    this.profileBaseUrl = config.profileBaseUrl ?? "https://app.vssps.visualstudio.com";
  }

  begin(reauthorizeConnectionId: ConnectionId | null = null): { readonly url: string } {
    if (reauthorizeConnectionId !== null) {
      const connection = this.database
        .query<{ provider: string }, [string]>("SELECT provider FROM connections WHERE id = ?")
        .get(reauthorizeConnectionId);
      if (connection?.provider !== "azure_devops") {
        throw new Error("Azure DevOps Connection was not found.");
      }
    }
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorizationId = prefixedRandomId("azr_");
    const encrypted = encrypt(verifier, this.config.encryptionKey);
    const createdAt = this.now();
    this.database
      .query<
        void,
        [string, string, Uint8Array, Uint8Array, Uint8Array, string | null, string, string]
      >(
        `INSERT INTO azure_oauth_authorizations(
           id, state_hash, code_verifier_ciphertext, code_verifier_iv,
           code_verifier_auth_tag, reauthorize_connection_id, expires_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        authorizationId,
        sha256(state),
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        reauthorizeConnectionId,
        new Date(createdAt.getTime() + 10 * 60_000).toISOString(),
        createdAt.toISOString(),
      );
    const url = new URL(this.authorizeUrl);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", AZURE_DEVOPS_SCOPE);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return { url: url.toString() };
  }

  async callback(state: string, code: string): Promise<string> {
    const consumedAt = this.now();
    const row = this.database.transaction(() => {
      const current = this.database
        .query<AuthorizationRow, [string]>(
          "SELECT * FROM azure_oauth_authorizations WHERE state_hash = ?",
        )
        .get(sha256(state));
      if (
        current === null ||
        current.callback_consumed_at !== null ||
        current.completed_at !== null ||
        current.expires_at <= consumedAt.toISOString() ||
        current.code_verifier_ciphertext === null ||
        current.code_verifier_iv === null ||
        current.code_verifier_auth_tag === null
      ) {
        throw new Error("Azure DevOps authorization state is invalid or expired.");
      }
      const changed = this.database
        .query<void, [string, string]>(
          `UPDATE azure_oauth_authorizations
           SET callback_consumed_at = ?, code_verifier_ciphertext = NULL,
               code_verifier_iv = NULL, code_verifier_auth_tag = NULL
           WHERE id = ? AND callback_consumed_at IS NULL`,
        )
        .run(consumedAt.toISOString(), current.id).changes;
      if (changed !== 1) throw new Error("Azure DevOps authorization state was already used.");
      return current;
    })();
    const verifier = decrypt(
      {
        ciphertext: row.code_verifier_ciphertext as Uint8Array,
        iv: row.code_verifier_iv as Uint8Array,
        authTag: row.code_verifier_auth_tag as Uint8Array,
      },
      this.config.encryptionKey,
    );
    const token = await this.exchangeCode(code, verifier);
    const profile = record(
      await this.authorizedJson(
        new URL("/_apis/profile/profiles/me?api-version=7.1", this.profileBaseUrl),
        token.accessToken,
      ),
      "Azure DevOps profile",
    );
    const externalAccountId = requiredString(profile.id, "Azure DevOps profile ID");
    const organizationsResponse = record(
      await this.authorizedJson(
        new URL(
          `/_apis/accounts?memberId=${encodeURIComponent(externalAccountId)}&api-version=7.1`,
          this.profileBaseUrl,
        ),
        token.accessToken,
      ),
      "Azure DevOps organizations",
    );
    const organizations = array(organizationsResponse.value, "Azure DevOps organizations").map(
      (item) => {
        const organization = record(item, "Azure DevOps organization");
        return {
          id: requiredString(organization.accountId, "Azure DevOps organization ID"),
          name: requiredString(organization.accountName, "Azure DevOps organization name"),
        };
      },
    );
    const snapshot: AuthorizationSnapshot = {
      externalAccountId,
      displayName:
        optionalString(profile.displayName) ??
        optionalString(profile.emailAddress) ??
        externalAccountId,
      refreshToken: token.refreshToken,
      organizations,
    };
    const encrypted = encrypt(JSON.stringify(snapshot), this.config.encryptionKey);
    this.database
      .query<void, [Uint8Array, Uint8Array, Uint8Array, string, string]>(
        `UPDATE azure_oauth_authorizations
         SET snapshot_ciphertext = ?, snapshot_iv = ?, snapshot_auth_tag = ?, expires_at = ?
         WHERE id = ? AND completed_at IS NULL`,
      )
      .run(
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        new Date(consumedAt.getTime() + 15 * 60_000).toISOString(),
        row.id,
      );
    return row.id;
  }

  organizations(authorizationId: string): readonly AzureOrganization[] {
    return this.snapshot(authorizationId).snapshot.organizations;
  }

  complete(authorizationId: string, organizationId: string): Connection {
    const { row, snapshot } = this.snapshot(authorizationId);
    const organization = snapshot.organizations.find((item) => item.id === organizationId);
    if (organization === undefined) {
      throw new Error("Selected Azure DevOps organization is not in the authorization snapshot.");
    }
    const now = this.now().toISOString();
    return this.database.transaction(() => {
      const fresh = this.database
        .query<AuthorizationRow, [string]>("SELECT * FROM azure_oauth_authorizations WHERE id = ?")
        .get(authorizationId);
      if (fresh === null || fresh.completed_at !== null || fresh.expires_at <= now) {
        throw new Error("Azure DevOps authorization is invalid or expired.");
      }
      let connection = this.database
        .query<
          {
            id: string;
            created_at: string;
          },
          [string]
        >(
          `SELECT id, created_at FROM connections
           WHERE provider = 'azure_devops' AND organization_id = ?`,
        )
        .get(organization.id);
      if (row.reauthorize_connection_id !== null) {
        const target = this.database
          .query<{ id: string; organization_id: string; created_at: string }, [string]>(
            `SELECT id, organization_id, created_at FROM connections
             WHERE id = ? AND provider = 'azure_devops'`,
          )
          .get(row.reauthorize_connection_id);
        if (target === null || target.organization_id !== organization.id) {
          throw new Error("Reauthorization must keep the existing Azure DevOps organization.");
        }
        connection = { id: target.id, created_at: target.created_at };
      }
      const encryptedToken = encrypt(snapshot.refreshToken, this.config.encryptionKey);
      const id = connection?.id ?? prefixedRandomId("con_");
      if (connection === null) {
        this.database
          .query<
            void,
            [
              string,
              string,
              string,
              string,
              string,
              Uint8Array,
              Uint8Array,
              Uint8Array,
              string,
              string,
            ]
          >(
            `INSERT INTO connections(
               id, provider, host, external_account_id, display_name,
               organization_id, organization_name, status,
               refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
               created_at, updated_at
             ) VALUES (?, 'azure_devops', 'https://dev.azure.com', ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            snapshot.externalAccountId,
            snapshot.displayName,
            organization.id,
            organization.name,
            encryptedToken.ciphertext,
            encryptedToken.iv,
            encryptedToken.authTag,
            now,
            now,
          );
      } else {
        this.database
          .query<
            void,
            [string, string, string, string, Uint8Array, Uint8Array, Uint8Array, string, string]
          >(
            `UPDATE connections
             SET external_account_id = ?, display_name = ?, organization_id = ?,
                 organization_name = ?, status = 'active',
                 refresh_token_ciphertext = ?, refresh_token_iv = ?,
                 refresh_token_auth_tag = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            snapshot.externalAccountId,
            snapshot.displayName,
            organization.id,
            organization.name,
            encryptedToken.ciphertext,
            encryptedToken.iv,
            encryptedToken.authTag,
            now,
            id,
          );
      }
      this.database
        .query<void, [string, string]>(
          `UPDATE azure_oauth_authorizations
           SET completed_at = ?, snapshot_ciphertext = NULL,
               snapshot_iv = NULL, snapshot_auth_tag = NULL
           WHERE id = ? AND completed_at IS NULL`,
        )
        .run(now, authorizationId);
      const result: Connection = {
        id: id as ConnectionId,
        provider: "azure_devops",
        host: "https://dev.azure.com",
        externalAccountId: snapshot.externalAccountId,
        displayName: snapshot.displayName,
        organizationId: organization.id,
        organizationName: organization.name,
        status: "active",
        createdAt: connection?.created_at ?? now,
        updatedAt: now,
      };
      return result;
    })();
  }

  private snapshot(authorizationId: string): {
    readonly row: AuthorizationRow;
    readonly snapshot: AuthorizationSnapshot;
  } {
    const row = this.database
      .query<AuthorizationRow, [string]>("SELECT * FROM azure_oauth_authorizations WHERE id = ?")
      .get(authorizationId);
    if (
      row === null ||
      row.completed_at !== null ||
      row.callback_consumed_at === null ||
      row.expires_at <= this.now().toISOString() ||
      row.snapshot_ciphertext === null ||
      row.snapshot_iv === null ||
      row.snapshot_auth_tag === null
    ) {
      throw new Error("Azure DevOps authorization is invalid or expired.");
    }
    return {
      row,
      snapshot: JSON.parse(
        decrypt(
          {
            ciphertext: row.snapshot_ciphertext,
            iv: row.snapshot_iv,
            authTag: row.snapshot_auth_tag,
          },
          this.config.encryptionKey,
        ),
      ) as AuthorizationSnapshot,
    };
  }

  private async exchangeCode(
    code: string,
    verifier: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: verifier,
      scope: AZURE_DEVOPS_SCOPE,
    });
    return this.tokenRequest(body);
  }

  private async tokenRequest(
    body: URLSearchParams,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const response = await this.request(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const value = record(await response.json(), "Microsoft token response");
    if (!response.ok) {
      throw new AzureTokenError(response.status, optionalString(value.error) ?? "token_error");
    }
    return {
      accessToken: requiredString(value.access_token, "Microsoft access token"),
      refreshToken: requiredString(value.refresh_token, "Microsoft refresh token"),
    };
  }

  private async authorizedJson(url: URL, accessToken: string): Promise<unknown> {
    const response = await this.request(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Azure DevOps request failed with status ${response.status}.`);
    }
    return response.json();
  }
}

export class AzureAccessTokenManager {
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();
  private readonly locks = new Map<string, Promise<string>>();
  private readonly request: FetchImplementation;
  private readonly tokenUrl: string;

  constructor(
    private readonly database: Database,
    private readonly config: AzureDevOpsConfig,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.request = config.fetch ?? fetch;
    this.tokenUrl =
      config.tokenUrl ?? "https://login.microsoftonline.com/organizations/oauth2/v2.0/token";
  }

  token(connection: Connection): Promise<string> {
    const azure = azureConnection(connection);
    const cached = this.cache.get(azure.id);
    if (cached !== undefined && cached.expiresAt - 60_000 > this.now().getTime()) {
      return Promise.resolve(cached.token);
    }
    const existing = this.locks.get(azure.id);
    if (existing !== undefined) return existing;
    const refresh = this.refresh(azure).finally(() => this.locks.delete(azure.id));
    this.locks.set(azure.id, refresh);
    return refresh;
  }

  private async refresh(
    connection: Extract<Connection, { provider: "azure_devops" }>,
  ): Promise<string> {
    const row = this.database
      .query<
        {
          refresh_token_ciphertext: Uint8Array | null;
          refresh_token_iv: Uint8Array | null;
          refresh_token_auth_tag: Uint8Array | null;
        },
        [string]
      >(
        `SELECT refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag
         FROM connections WHERE id = ? AND provider = 'azure_devops'`,
      )
      .get(connection.id);
    if (
      row?.refresh_token_ciphertext === null ||
      row?.refresh_token_ciphertext === undefined ||
      row.refresh_token_iv === null ||
      row.refresh_token_auth_tag === null
    ) {
      throw new Error("Azure DevOps Connection has no refresh credential.");
    }
    const refreshToken = decrypt(
      {
        ciphertext: row.refresh_token_ciphertext,
        iv: row.refresh_token_iv,
        authTag: row.refresh_token_auth_tag,
      },
      this.config.encryptionKey,
    );
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: AZURE_DEVOPS_SCOPE,
    });
    const response = await this.request(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const value = record(await response.json(), "Microsoft token response");
    if (!response.ok) {
      const code = optionalString(value.error) ?? "token_error";
      if (code === "invalid_grant") {
        this.database
          .query<void, [string, string]>(
            `UPDATE connections
             SET status = 'reauthorization_required', updated_at = ?
             WHERE id = ?`,
          )
          .run(this.now().toISOString(), connection.id);
      }
      throw new AzureTokenError(response.status, code);
    }
    const accessToken = requiredString(value.access_token, "Microsoft access token");
    const rotatedRefresh = optionalString(value.refresh_token) ?? refreshToken;
    const expiresIn = typeof value.expires_in === "number" ? value.expires_in : 3600;
    if (rotatedRefresh !== refreshToken) {
      const encrypted = encrypt(rotatedRefresh, this.config.encryptionKey);
      this.database.transaction(() => {
        this.database
          .query<void, [Uint8Array, Uint8Array, Uint8Array, string, string]>(
            `UPDATE connections
             SET refresh_token_ciphertext = ?, refresh_token_iv = ?,
                 refresh_token_auth_tag = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            encrypted.ciphertext,
            encrypted.iv,
            encrypted.authTag,
            this.now().toISOString(),
            connection.id,
          );
      })();
    }
    this.cache.set(connection.id, {
      token: accessToken,
      expiresAt: this.now().getTime() + Math.max(1, expiresIn) * 1000,
    });
    return accessToken;
  }
}

export class AzureDevOpsProvider implements ManagedGitProvider {
  readonly provider = "azure_devops" as const;
  private readonly request: FetchImplementation;
  private readonly apiBaseUrl: string;

  constructor(
    private readonly tokens: AzureAccessTokenManager,
    config: Pick<AzureDevOpsConfig, "fetch" | "apiBaseUrl">,
  ) {
    this.request = config.fetch ?? fetch;
    this.apiBaseUrl = config.apiBaseUrl ?? "https://dev.azure.com";
  }

  async listRepositories(connection: Connection): Promise<readonly RemoteRepository[]> {
    const azure = azureConnection(connection);
    const value = record(
      await this.api(
        connection,
        `/${encodeURIComponent(azure.organizationName)}/_apis/git/repositories?api-version=7.1`,
      ),
      "Azure DevOps repositories",
    );
    return array(value.value, "Azure DevOps repositories").map(azureRepository);
  }

  async getRepository(connection: Connection, repositoryId: string): Promise<RemoteRepository> {
    const azure = azureConnection(connection);
    return azureRepository(
      await this.api(
        connection,
        `/${encodeURIComponent(azure.organizationName)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}?api-version=7.1`,
      ),
    );
  }

  async listBranches(
    connection: Connection,
    _repository: string,
    repositoryId?: string,
  ): Promise<readonly RemoteBranch[]> {
    if (repositoryId === undefined) throw new Error("Azure DevOps repository ID is required.");
    const azure = azureConnection(connection);
    const value = record(
      await this.api(
        connection,
        `/${encodeURIComponent(azure.organizationName)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/refs?filter=heads/&api-version=7.1`,
      ),
      "Azure DevOps refs",
    );
    return array(value.value, "Azure DevOps refs").map((item) => {
      const row = record(item, "Azure DevOps ref");
      return {
        name: normalizeRef(requiredString(row.name, "Azure DevOps ref name")),
        sha: requiredString(row.objectId, "Azure DevOps ref SHA"),
        protected: null,
      };
    });
  }

  async gitCredentials(
    connection: Connection,
    repositoryId: string,
  ): Promise<ManagedGitCredentials> {
    const repository = await this.getRepository(connection, repositoryId);
    return {
      kind: "bearer",
      cloneUrl: repository.cloneUrl,
      token: await this.tokens.token(connection),
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
    };
  }

  async publishPullRequest(
    connection: Connection,
    repository: string,
    repositoryId: string,
    input: PullRequestInput,
    existingUrl: string | null,
  ): Promise<string> {
    const azure = azureConnection(connection);
    const projectName = repository.split("/")[0];
    if (projectName === undefined || projectName.length === 0) {
      throw new Error("Azure DevOps repository full name is invalid.");
    }
    const basePath =
      `/${encodeURIComponent(azure.organizationName)}/${encodeURIComponent(projectName)}` +
      `/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests`;
    let pullRequestId: string | undefined;
    const pullRequestIdFromUrl = existingUrl?.match(/\/pullrequest\/(\d+)\/?$/u)?.[1];
    if (pullRequestIdFromUrl !== undefined) {
      const candidate = record(
        await this.api(
          connection,
          `${basePath}/${encodeURIComponent(pullRequestIdFromUrl)}?api-version=7.1`,
        ),
        "Azure DevOps pull request",
      );
      if (candidate.status === "active") {
        pullRequestId = pullRequestIdFromUrl;
      }
    }
    if (pullRequestId === undefined) {
      const query = new URLSearchParams({
        "searchCriteria.status": "active",
        "searchCriteria.sourceRefName": fullRef(input.head),
        "searchCriteria.targetRefName": fullRef(input.base),
        "api-version": "7.1",
      });
      const result = record(
        await this.api(connection, `${basePath}?${query.toString()}`),
        "Azure DevOps pull requests",
      );
      const existing = array(result.value, "Azure DevOps pull requests")[0];
      if (existing !== undefined) {
        pullRequestId = String(record(existing, "Azure DevOps pull request").pullRequestId);
      }
    }
    const payload = {
      title: input.title,
      description: truncatePullRequestDescription(input.body),
      isDraft: true,
    };
    if (pullRequestId !== undefined) {
      const updated = record(
        await this.api(
          connection,
          `${basePath}/${encodeURIComponent(pullRequestId)}?api-version=7.1`,
          {
            method: "PATCH",
            body: JSON.stringify(payload),
          },
        ),
        "Azure DevOps pull request",
      );
      return pullRequestWebUrl(updated);
    }
    const created = record(
      await this.api(connection, `${basePath}?api-version=7.1`, {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          sourceRefName: fullRef(input.head),
          targetRefName: fullRef(input.base),
        }),
      }),
      "Azure DevOps pull request",
    );
    return pullRequestWebUrl(created);
  }

  private async api(
    connection: Connection,
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const response = await this.request(new URL(path, this.apiBaseUrl), {
      ...init,
      headers: {
        Authorization: `Bearer ${await this.tokens.token(connection)}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`Azure DevOps request failed with status ${response.status}.`);
    }
    return response.json();
  }
}

export class AzureTokenError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Microsoft token request failed (${status}, ${code}).`);
    this.name = "AzureTokenError";
  }
}

export function parseConnectionEncryptionKey(value: string | undefined): Uint8Array | null {
  if (value === undefined) return null;
  const key = Buffer.from(value, "base64");
  if (
    key.byteLength !== 32 ||
    key.toString("base64").replace(/=+$/u, "") !== value.replace(/=+$/u, "")
  ) {
    throw new Error("AIWS_CONNECTION_ENCRYPTION_KEY must encode exactly 32 bytes.");
  }
  return key;
}

export function truncatePullRequestDescription(body: string): string {
  if (body.length <= 4_000) return body;
  const footer = body.match(/(?:^|\n\n)(AIWS Task: [^\n]+)\s*$/u)?.[1];
  if (footer === undefined) return body.slice(0, 4_000);
  const suffix = `\n\n${footer}`;
  return `${body.slice(0, 4_000 - suffix.length).trimEnd()}${suffix}`;
}

function azureRepository(value: unknown): RemoteRepository {
  const row = record(value, "Azure DevOps repository");
  const project = record(row.project, "Azure DevOps project");
  const projectName = requiredString(project.name, "Azure DevOps project name");
  const name = requiredString(row.name, "Azure DevOps repository name");
  return {
    id: requiredString(row.id, "Azure DevOps repository ID"),
    fullName: `${projectName}/${name}`,
    name,
    description: optionalString(row.description) ?? "",
    webUrl: requiredString(row.webUrl, "Azure DevOps repository Web URL"),
    cloneUrl: requiredString(row.remoteUrl, "Azure DevOps repository clone URL"),
    defaultBranch: normalizeRef(requiredString(row.defaultBranch, "Azure DevOps default branch")),
    private: true,
  };
}

function pullRequestWebUrl(value: Record<string, unknown>): string {
  const links = record(value._links, "Azure DevOps pull request links");
  const web = record(links.web, "Azure DevOps pull request Web link");
  return requiredString(web.href, "Azure DevOps pull request URL");
}

function azureConnection(
  connection: Connection,
): Extract<Connection, { provider: "azure_devops" }> {
  if (connection.provider !== "azure_devops") {
    throw new Error("Azure DevOps provider received a non-Azure Connection.");
  }
  if (connection.status !== "active") {
    throw new Error("Azure DevOps Connection is not active.");
  }
  return connection;
}

function encrypt(value: string, key: Uint8Array): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function decrypt(value: EncryptedValue, key: Uint8Array): string {
  const decipher = createDecipheriv("aes-256-gcm", key, value.iv);
  decipher.setAuthTag(value.authTag);
  return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]).toString("utf8");
}

function prefixedRandomId(prefix: "azr_" | "con_"): string {
  return `${prefix}${randomBytes(16).toString("hex").slice(0, 26).toUpperCase()}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fullRef(value: string): string {
  return value.startsWith("refs/heads/") ? value : `refs/heads/${value}`;
}

function normalizeRef(value: string): string {
  return value.startsWith("refs/heads/") ? value.slice("refs/heads/".length) : value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
