import { describe, expect, test } from "bun:test";
import {
  archiveProject,
  createProject,
  InvalidTransitionError,
  type ProjectId,
  unarchiveProject,
  updateProject,
  ValidationError,
  type AgentProfileId,
} from "../src/index.ts";

const projectId = "prj_01K0ABCDEFGHIJKLMNOPQRSTUV" as ProjectId;
const now = "2026-07-21T10:00:00.000Z";
const curationProfileId = "agp_01K0ABCDEFGHIJKLMNOPQRSTUV" as AgentProfileId;
const implementationProfileId = "agp_01K1ABCDEFGHIJKLMNOPQRSTUV" as AgentProfileId;

function validProject() {
  return createProject({
    id: projectId,
    name: "AIWS",
    description: "Local task manager",
    repositoryPath: "/srv/repos/aiws",
    gitProvider: "github",
    accountScope: "personal",
    now,
  });
}

describe("Project domain", () => {
  test("creates the single repository inventory with documented defaults", () => {
    const project = createProject({
      id: projectId,
      name: "AIWS",
      repositoryPath: "/srv/repos/aiws",
      gitProvider: "other",
      accountScope: "work",
      now,
    });

    expect(project.description).toBe("");
    expect(project.repositoryPath).toBe("/srv/repos/aiws");
    expect(project.archivedAt).toBeNull();
  });

  test.each([
    ["blank name", { name: "  " }],
    ["long name", { name: "x".repeat(121) }],
    ["long description", { description: "x".repeat(10_001) }],
    ["relative repository path", { repositoryPath: "repos/aiws" }],
    ["unknown provider", { gitProvider: "bitbucket" }],
    ["unknown account scope", { accountScope: "team" }],
  ])("rejects %s", (_label, override) => {
    expect(() => createProject({ ...validProject(), ...override, now } as never)).toThrow(
      ValidationError,
    );
  });

  test("updates every mutable field", () => {
    const updated = updateProject(
      validProject(),
      {
        name: "AIWS Core",
        description: "Updated",
        repositoryPath: "/srv/repos/core",
        gitProvider: "gitlab",
        accountScope: "work",
      },
      "2026-07-21T11:00:00.000Z",
    );

    expect(updated).toMatchObject({
      name: "AIWS Core",
      description: "Updated",
      repositoryPath: "/srv/repos/core",
      gitProvider: "gitlab",
      accountScope: "work",
      updatedAt: "2026-07-21T11:00:00.000Z",
    });
  });

  test("configures Curation and Implementation profiles independently", () => {
    const curationOnly = updateProject(
      validProject(),
      { curationAgentProfileId: curationProfileId },
      now,
    );
    expect(curationOnly).toMatchObject({
      curationAgentProfileId: curationProfileId,
      implementationAgentProfileId: null,
      automationEnabled: false,
    });

    expect(() => updateProject(curationOnly, { automationEnabled: true }, now)).toThrow(
      ValidationError,
    );
    const automated = updateProject(
      curationOnly,
      {
        implementationAgentProfileId: implementationProfileId,
        automationEnabled: true,
      },
      now,
    );
    expect(automated).toMatchObject({
      curationAgentProfileId: curationProfileId,
      implementationAgentProfileId: implementationProfileId,
      automationEnabled: true,
    });
  });

  test("archive and unarchive are idempotent", () => {
    const archived = archiveProject(validProject(), "2026-07-21T11:00:00.000Z");
    expect(archiveProject(archived, "2026-07-21T12:00:00.000Z")).toBe(archived);

    const active = unarchiveProject(archived, "2026-07-21T12:00:00.000Z");
    expect(active.archivedAt).toBeNull();
    expect(unarchiveProject(active, "2026-07-21T13:00:00.000Z")).toBe(active);
  });

  test("an archived Project is read-only", () => {
    const archived = archiveProject(validProject(), "2026-07-21T11:00:00.000Z");
    expect(() => updateProject(archived, { name: "Changed" }, now)).toThrow(InvalidTransitionError);
  });

  test("cannot change identity or archive state through update", () => {
    expect(() => updateProject(validProject(), { id: "replacement" } as never, now)).toThrow(
      ValidationError,
    );
    expect(() => updateProject(validProject(), { archivedAt: now } as never, now)).toThrow(
      ValidationError,
    );
  });
});
