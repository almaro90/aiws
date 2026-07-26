import type {
  AgentProfile,
  AgentProfileUseCases,
  Connection,
  ConnectionUseCases,
  Project,
  ProjectUseCases,
} from "@aiws/core";
import type {
  ManagedGitProvider,
  ManagedGitProviderRegistry,
} from "./integrations/managed-git-provider.ts";
import type {
  RunnerControlClient,
  RunnerReadinessProfile,
} from "./integrations/runner-model-catalog.ts";
import type { RunnerActivityMonitor } from "./runner-activity.ts";

export type ProjectReadinessDepth = "standard" | "deep";
export type ProjectReadinessStatus = "pass" | "warning" | "fail" | "skipped";

export interface ProjectReadinessCheck {
  readonly id: string;
  readonly status: ProjectReadinessStatus;
  readonly message: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ProjectReadinessReport {
  readonly projectId: string;
  readonly depth: ProjectReadinessDepth;
  readonly checkedAt: string;
  readonly durationMs: number;
  readonly ok: boolean;
  readonly checks: readonly ProjectReadinessCheck[];
}

interface Dependencies {
  readonly projects: Pick<ProjectUseCases, "get">;
  readonly connections: Pick<ConnectionUseCases, "get">;
  readonly agentProfiles: Pick<AgentProfileUseCases, "get">;
  readonly managedGitProviders: ManagedGitProviderRegistry;
  readonly runnerActivity: Pick<RunnerActivityMonitor, "status">;
  readonly runnerControl?: Pick<RunnerControlClient, "list" | "readiness">;
  readonly clock: { now(): Date };
  readonly monotonicNow?: () => number;
}

export class ProjectReadinessService {
  private readonly monotonicNow: () => number;

  constructor(private readonly dependencies: Dependencies) {
    this.monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  }

  async check(
    projectId: Parameters<ProjectUseCases["get"]>[0],
    depth: ProjectReadinessDepth,
  ): Promise<ProjectReadinessReport> {
    const started = this.monotonicNow();
    const checkedAt = this.dependencies.clock.now().toISOString();
    const project = await this.dependencies.projects.get(projectId);
    const checks: ProjectReadinessCheck[] = [];
    checks.push(projectCheck(project));

    let connection: Connection | null = null;
    if (project.repositoryMode !== "managed" || project.connectionId === null) {
      checks.push(failed("connection", "Managed Connection is not configured."));
    } else {
      try {
        connection = await this.dependencies.connections.get(project.connectionId);
        checks.push(
          connection.status === "active"
            ? passed("connection", "Connection is active.", { provider: connection.provider })
            : failed("connection", "Connection is not active.", { status: connection.status }),
        );
      } catch {
        checks.push(failed("connection", "Connection is unavailable."));
      }
    }

    const provider = providerFor(connection, this.dependencies.managedGitProviders, checks);
    await this.remoteChecks(project, connection, provider, checks);

    const profiles: RunnerReadinessProfile[] = [];
    await this.profileCheck(
      "curation",
      project.curationAgentProfileId,
      "curation_profile",
      checks,
      profiles,
    );
    await this.profileCheck(
      "implementation",
      project.implementationAgentProfileId,
      "implementation_profile",
      checks,
      profiles,
    );

    const runner = this.dependencies.runnerActivity.status();
    checks.push(
      runner.status === "online"
        ? passed("runner", "Runner is online.", { status: runner.status })
        : failed("runner", `Runner status is ${runner.status}.`, { status: runner.status }),
    );

    for (const profile of profiles) {
      checks.push(await this.modelAuthenticationCheck(profile));
    }

    if (depth === "deep") {
      if (this.dependencies.runnerControl === undefined) {
        checks.push(failed("deep_probe", "Runner control is not configured."));
      } else {
        try {
          const deep = await this.dependencies.runnerControl.readiness([]);
          checks.push(...deep.map((check) => ({ ...check, details: {} })));
        } catch {
          checks.push(failed("deep_probe", "Runner deep probe is unavailable."));
        }
      }
    }

    return {
      projectId: project.id,
      depth,
      checkedAt,
      durationMs: Math.max(0, Math.round(this.monotonicNow() - started)),
      ok: checks.every((check) => check.status !== "fail"),
      checks,
    } satisfies ProjectReadinessReport;
  }

  private async remoteChecks(
    project: Project,
    connection: Connection | null,
    provider: ManagedGitProvider | null,
    checks: ProjectReadinessCheck[],
  ): Promise<void> {
    if (
      connection === null ||
      connection.status !== "active" ||
      provider === null ||
      project.remoteRepositoryId === null ||
      project.remoteFullName === null
    ) {
      checks.push(
        skipped("repository", "Remote repository check skipped."),
        skipped("base_branch", "Base Branch check skipped."),
        skipped("git_credentials", "Git credentials check skipped."),
      );
      return;
    }
    try {
      const repository = await provider.getRepository(connection, project.remoteRepositoryId);
      checks.push(
        passed("repository", "Remote repository is accessible.", {
          repository: repository.fullName,
        }),
      );
    } catch {
      checks.push(
        failed("repository", "Remote repository is unavailable."),
        skipped("base_branch", "Base Branch check skipped because repository access failed."),
        skipped(
          "git_credentials",
          "Git credentials check skipped because repository access failed.",
        ),
      );
      return;
    }
    try {
      const branches = await provider.listBranches(
        connection,
        project.remoteFullName,
        project.remoteRepositoryId,
      );
      const found =
        project.defaultBranch !== null &&
        branches.some((branch) => branch.name === project.defaultBranch);
      checks.push(
        found
          ? passed("base_branch", "Configured Base Branch exists.", {
              branch: project.defaultBranch,
            })
          : failed("base_branch", "Configured Base Branch is unavailable."),
      );
    } catch {
      checks.push(failed("base_branch", "Base Branch could not be verified."));
    }
    try {
      await provider.gitCredentials(connection, project.remoteRepositoryId);
      checks.push(passed("git_credentials", "Ephemeral Git credentials are available."));
    } catch {
      checks.push(failed("git_credentials", "Ephemeral Git credentials are unavailable."));
    }
  }

  private async profileCheck(
    kind: RunnerReadinessProfile["kind"],
    id: Project["curationAgentProfileId"],
    checkId: string,
    checks: ProjectReadinessCheck[],
    profiles: RunnerReadinessProfile[],
  ): Promise<void> {
    if (id === null) {
      checks.push(failed(checkId, `${label(kind)} Agent Profile is not configured.`));
      return;
    }
    let profile: AgentProfile;
    try {
      profile = await this.dependencies.agentProfiles.get(id);
    } catch {
      checks.push(failed(checkId, `${label(kind)} Agent Profile is unavailable.`));
      return;
    }
    if (!profile.enabled) {
      checks.push(failed(checkId, `${label(kind)} Agent Profile is disabled.`));
      return;
    }
    checks.push(
      passed(checkId, `${label(kind)} Agent Profile is enabled.`, {
        agentProfileId: profile.id,
      }),
    );
    profiles.push({
      kind,
      authMode: profile.authMode,
      credentialReference: profile.credentialReference,
      model: profile.model,
      reasoningEffort: profile.reasoningEffort,
    });
  }

  private async modelAuthenticationCheck(
    profile: RunnerReadinessProfile,
  ): Promise<ProjectReadinessCheck> {
    const id = `${profile.kind}_model_authentication`;
    if (this.dependencies.runnerControl === undefined) {
      return failed(id, `${label(profile.kind)} model authentication is unavailable.`);
    }
    try {
      const catalog = await this.dependencies.runnerControl.list(
        profile.authMode,
        profile.credentialReference,
      );
      const model = catalog.models.find((candidate) => candidate.id === profile.model);
      if (
        model === undefined ||
        profile.reasoningEffort === null ||
        !model.supportedReasoningEfforts.includes(profile.reasoningEffort)
      ) {
        return failed(id, `${label(profile.kind)} model selection is no longer available.`);
      }
      return passed(id, `${label(profile.kind)} model authentication succeeded.`);
    } catch {
      return failed(id, `${label(profile.kind)} model authentication failed.`);
    }
  }
}

function projectCheck(project: Project): ProjectReadinessCheck {
  if (project.archivedAt !== null) return failed("project", "Project is archived.");
  if (project.repositoryMode !== "managed")
    return failed("project", "Project Readiness requires a managed Project.");
  return passed("project", "Managed Project is active.");
}

function providerFor(
  connection: Connection | null,
  registry: ManagedGitProviderRegistry,
  checks: ProjectReadinessCheck[],
): ManagedGitProvider | null {
  if (connection === null || connection.status !== "active") return null;
  try {
    return registry.resolve(connection);
  } catch {
    checks.push(failed("provider", "Managed Git provider is not configured."));
    return null;
  }
}

function passed(
  id: string,
  message: string,
  details: ProjectReadinessCheck["details"] = {},
): ProjectReadinessCheck {
  return { id, status: "pass", message, details };
}

function failed(
  id: string,
  message: string,
  details: ProjectReadinessCheck["details"] = {},
): ProjectReadinessCheck {
  return { id, status: "fail", message, details };
}

function skipped(id: string, message: string): ProjectReadinessCheck {
  return { id, status: "skipped", message, details: {} };
}

function label(kind: RunnerReadinessProfile["kind"]): string {
  return kind === "curation" ? "Curation" : "Implementation";
}
