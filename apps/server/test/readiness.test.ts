import { describe, expect, test } from "bun:test";
import type { AgentProfile, Connection, Project } from "@aiws/core";
import {
  ManagedGitProviderRegistry,
  type ManagedGitProvider,
} from "../src/integrations/managed-git-provider.ts";
import { ProjectReadinessService } from "../src/readiness.ts";

const now = "2026-07-26T10:00:00.000Z";
const connection = {
  id: "con_01K0ABCDEFGHIJKLMNOPQRSTUV",
  provider: "github",
  host: "https://github.com",
  externalAccountId: "42",
  displayName: "acme",
  installationId: "7",
  status: "active",
  createdAt: now,
  updatedAt: now,
} as Connection;
const project = {
  id: "prj_01K0ABCDEFGHIJKLMNOPQRSTUV",
  name: "AIWS",
  description: "",
  repositoryPath: "/repositories/aiws",
  gitProvider: "github",
  accountScope: "work",
  repositoryMode: "managed",
  connectionId: connection.id,
  remoteRepositoryId: "10",
  remoteFullName: "acme/aiws",
  remoteWebUrl: "https://github.com/acme/aiws",
  defaultBranch: "main",
  automationEnabled: true,
  curationAgentProfileId: "agp_01K0ABCDEFGHIJKLMNOPQRSTUV",
  implementationAgentProfileId: "agp_01K0ABCDEFGHIJKLMNOPQRSTUW",
  scheduleCron: null,
  scheduleTimezone: "UTC",
  maxConcurrency: 1,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
} as Project;

describe("Project Readiness service", () => {
  test("returns provider-neutral standard and deep evidence without persistence", async () => {
    const service = fixture();
    const report = await service.check(project.id, "deep");
    expect(report.ok).toBe(true);
    expect(report.checkedAt).toBe(now);
    expect(report.checks.map((check) => check.id)).toEqual([
      "project",
      "connection",
      "repository",
      "base_branch",
      "git_credentials",
      "curation_profile",
      "implementation_profile",
      "runner",
      "curation_model_authentication",
      "implementation_model_authentication",
      "agent_image",
    ]);
  });

  test("returns safe failures and skips dependent remote checks", async () => {
    const service = fixture({ connection: { ...connection, status: "revoked" } as Connection });
    const report = await service.check(project.id, "standard");
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "connection")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "repository")?.status).toBe("skipped");
  });
});

function fixture(overrides: { readonly connection?: Connection } = {}): ProjectReadinessService {
  const selectedConnection = overrides.connection ?? connection;
  const provider: ManagedGitProvider = {
    provider: "github",
    listRepositories: async () => [],
    getRepository: async () => ({
      id: "10",
      fullName: "acme/aiws",
      name: "aiws",
      description: "",
      webUrl: "https://github.com/acme/aiws",
      cloneUrl: "https://github.com/acme/aiws.git",
      defaultBranch: "main",
      private: true,
    }),
    listBranches: async () => [{ name: "main", sha: "a".repeat(40), protected: true }],
    gitCredentials: async () => ({
      kind: "basic",
      cloneUrl: "https://github.com/acme/aiws.git",
      username: "x-access-token",
      password: "ephemeral",
      fullName: "acme/aiws",
      defaultBranch: "main",
    }),
    publishPullRequest: async () => "https://github.com/acme/aiws/pull/1",
    observeDelivery: async () => ({
      prState: "open",
      checksState: "passed",
      checksPassed: 1,
      checksFailed: 0,
      checksPending: 0,
      externalUpdatedAt: "2026-07-26T10:00:00.000Z",
    }),
  };
  const profiles = new Map<string, AgentProfile>([
    [
      project.curationAgentProfileId as string,
      agentProfile(project.curationAgentProfileId as string),
    ],
    [
      project.implementationAgentProfileId as string,
      agentProfile(project.implementationAgentProfileId as string),
    ],
  ]);
  let monotonic = 100;
  return new ProjectReadinessService({
    projects: { get: async () => project },
    connections: { get: async () => selectedConnection },
    agentProfiles: {
      get: async (id) => {
        const profile = profiles.get(id);
        if (profile === undefined) throw new Error("not found");
        return profile;
      },
    },
    managedGitProviders: new ManagedGitProviderRegistry([provider]),
    runnerActivity: {
      status: () => ({
        status: "online",
        lastSeenAt: now,
        offlineAfterSeconds: 45,
      }),
    },
    runnerControl: {
      list: async () => ({
        models: [
          {
            id: "gpt-test",
            name: "GPT Test",
            description: "",
            isDefault: true,
            defaultReasoningEffort: "high",
            supportedReasoningEfforts: ["high"],
          },
        ],
      }),
      readiness: async () => [
        { id: "agent_image", status: "pass", message: "Agent image is available." },
      ],
    },
    clock: { now: () => new Date(now) },
    monotonicNow: () => monotonic++,
  });
}

function agentProfile(id: string): AgentProfile {
  return {
    id,
    name: id,
    runtime: "codex",
    authMode: "api_key",
    credentialReference: "OPENAI_API_KEY",
    model: "gpt-test",
    reasoningEffort: "high",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  } as AgentProfile;
}
