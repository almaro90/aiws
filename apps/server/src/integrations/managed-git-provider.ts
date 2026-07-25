import type { Connection } from "@aiws/core";

export interface RemoteRepository {
  readonly id: string;
  readonly fullName: string;
  readonly name: string;
  readonly description: string;
  readonly webUrl: string;
  readonly cloneUrl: string;
  readonly defaultBranch: string;
  readonly private: boolean;
}

export interface RemoteBranch {
  readonly name: string;
  readonly sha: string;
  readonly protected: boolean | null;
}

export type ManagedGitCredentials =
  | {
      readonly kind: "basic";
      readonly cloneUrl: string;
      readonly username: "x-access-token";
      readonly password: string;
      readonly fullName: string;
      readonly defaultBranch: string;
    }
  | {
      readonly kind: "bearer";
      readonly cloneUrl: string;
      readonly token: string;
      readonly fullName: string;
      readonly defaultBranch: string;
    };

export interface PullRequestInput {
  readonly title: string;
  readonly body: string;
  readonly head: string;
  readonly base: string;
  readonly draft: boolean;
}

export interface ManagedGitProvider {
  readonly provider: Connection["provider"];
  listRepositories(connection: Connection): Promise<readonly RemoteRepository[]>;
  getRepository(connection: Connection, repositoryId: string): Promise<RemoteRepository>;
  listBranches(
    connection: Connection,
    repository: string,
    repositoryId?: string,
  ): Promise<readonly RemoteBranch[]>;
  gitCredentials(connection: Connection, repositoryId: string): Promise<ManagedGitCredentials>;
  publishPullRequest(
    connection: Connection,
    repository: string,
    repositoryId: string,
    input: PullRequestInput,
    existingUrl: string | null,
  ): Promise<string>;
}

export class ManagedGitProviderRegistry {
  private readonly providers = new Map<Connection["provider"], ManagedGitProvider>();

  constructor(providers: readonly ManagedGitProvider[]) {
    for (const provider of providers) this.providers.set(provider.provider, provider);
  }

  resolve(connection: Connection): ManagedGitProvider {
    const provider = this.providers.get(connection.provider);
    if (provider === undefined) {
      throw new Error(`Managed Git provider '${connection.provider}' is not configured.`);
    }
    return provider;
  }
}
