import { afterEach, describe, expect, test } from "bun:test";
import {
  ProjectUseCases,
  RevisionConflictError,
  SystemClock,
  UlidIdGenerator,
  VerificationContractUseCases,
} from "@aiws/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, SqliteUnitOfWork } from "../src/index.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "aiws-verification-"));
  directories.push(directory);
  const database = openDatabase({ path: join(directory, "aiws.sqlite") });
  const unitOfWork = new SqliteUnitOfWork(database);
  const clock = new SystemClock();
  const ids = new UlidIdGenerator(clock);
  return {
    database,
    unitOfWork,
    projects: new ProjectUseCases(unitOfWork, { clock, ids }),
    contracts: new VerificationContractUseCases(unitOfWork, { clock, ids }),
  };
}

const command = {
  name: "tests",
  executable: "bun",
  args: ["test"],
  required: true,
  timeoutSeconds: 300,
};
const commands = [command];

describe("Verification Contract persistence", () => {
  test("appends, replaces and disables revisions without mutating history", async () => {
    const value = fixture();
    const project = await value.projects.create({
      name: "Verification",
      repositoryPath: "/repos/verification",
      gitProvider: "github",
      accountScope: "work",
    });
    const first = await value.contracts.replace({
      projectId: project.id,
      expectedRevision: null,
      commands,
    });
    expect(first).toMatchObject({ latestRevision: 1, active: { revision: 1, enabled: true } });
    const second = await value.contracts.replace({
      projectId: project.id,
      expectedRevision: 1,
      commands: [{ ...command, name: "lint", args: ["run", "lint"] }],
    });
    expect(second).toMatchObject({ latestRevision: 2, active: { revision: 2 } });
    const disabled = await value.contracts.disable({
      projectId: project.id,
      expectedRevision: 2,
    });
    expect(disabled).toEqual({ projectId: project.id, latestRevision: 3, active: null });
    expect(await value.contracts.history(project.id)).toMatchObject([
      { revision: 3, enabled: false, commands: [] },
      { revision: 2, enabled: true, commands: [{ name: "lint" }] },
      { revision: 1, enabled: true, commands: [{ name: "tests" }] },
    ]);
    expect(() =>
      value.database
        .query("UPDATE verification_contract_revisions SET enabled = 0 WHERE project_id = ?")
        .run(project.id),
    ).toThrow("immutable");
    await value.unitOfWork.close();
  });

  test("allows exactly one concurrent writer for an expected revision", async () => {
    const value = fixture();
    const project = await value.projects.create({
      name: "Concurrent",
      repositoryPath: "/repos/concurrent",
      gitProvider: "github",
      accountScope: "work",
    });
    await value.contracts.replace({ projectId: project.id, expectedRevision: null, commands });
    const results = await Promise.allSettled([
      value.contracts.replace({ projectId: project.id, expectedRevision: 1, commands }),
      value.contracts.replace({ projectId: project.id, expectedRevision: 1, commands }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toBeInstanceOf(
      RevisionConflictError,
    );
    expect(
      (await value.contracts.history(project.id)).map((revision) => revision.revision),
    ).toEqual([2, 1]);
    await value.unitOfWork.close();
  });
});
